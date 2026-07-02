from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional
from datetime import date, datetime, timedelta, timezone

from app.models.database import get_db, Game, TeamSeasonStats
from app.services.ml_engine import (
    predict_game_outcome, predict_win_trend,
    detect_regression_flags, get_model_status,
)
from app.services.features import (
    build_game_features, build_prediction_features, FEATURE_LABELS,
    GAME_OUTCOME_FEATURE_NAMES, WIN_TREND_FEATURE_NAMES,
    _get_cubs_games, _rolling_pythag, _opponent_win_pct,
)

router = APIRouter()


@router.get("/game-outcome")
def get_game_outcome_prediction(
    db: Session = Depends(get_db),
):
    """Predict next game outcome using trained XGBoost model.

    If no upcoming game or model not trained, returns status info.
    Display with baselines: 'Coin flip = 50%. Vegas ~55%. Our model: X%.'
    """
    season = date.today().year

    # Find the next scheduled Cubs game
    next_game = db.query(Game).filter(
        Game.game_date >= date.today(),
        ((Game.home_team == "CHC") | (Game.away_team == "CHC")),
        Game.status == "scheduled",
    ).order_by(Game.game_date.asc()).first()

    if not next_game:
        status = get_model_status()
        return {
            **status["game_outcome"],
            "message": "No upcoming game scheduled",
            "baselines": {"coin_flip": 0.50, "typical_home_advantage": 0.54},
        }

    features = build_game_features(next_game.game_pk, db)
    if features is None:
        features = build_prediction_features(next_game.game_pk, db)
    if features is None:
        return {
            "status": "active",
            "win_probability": None,
            "message": "Insufficient game history for prediction",
        }

    result = predict_game_outcome(features)
    result["game"] = {
        "game_pk": next_game.game_pk,
        "date": next_game.game_date.isoformat(),
        "opponent": next_game.away_team if next_game.home_team == "CHC" else next_game.home_team,
        "is_home": next_game.home_team == "CHC",
    }
    result["feature_labels"] = {k: FEATURE_LABELS.get(k, k) for k in GAME_OUTCOME_FEATURE_NAMES}
    result["feature_values"] = features
    return result


@router.get("/win-trend")
def get_win_trend_prediction(
    db: Session = Depends(get_db),
):
    """Predict next-10-game win total using Ridge regression.

    Display: 'Avg error: ±X wins. Pythagorean alone: ±Y.'
    """
    season = date.today().year

    all_games = _get_cubs_games(season, db)
    cubs_stats = db.query(TeamSeasonStats).filter(
        TeamSeasonStats.team == "CHC",
        TeamSeasonStats.season == season,
    ).first()

    if len(all_games) < 30:
        status = get_model_status()
        return {
            **status["win_trend"],
            "message": f"Need 30+ games for trend prediction, currently {len(all_games)}",
        }

    pythag = _rolling_pythag(all_games, 30)

    features = {
        "rolling_30g_pythag_wpct": pythag or 0.500,
        "fip_trend": 0.0,
        "wrc_plus_trend": 0.0,
        "roster_war": 0.0,
        "sos_remaining": 0.500,
    }

    result = predict_win_trend(features)
    result["current_record"] = {
        "wins": cubs_stats.wins if cubs_stats else 0,
        "losses": cubs_stats.losses if cubs_stats else 0,
        "games_played": len(all_games),
    }
    result["feature_labels"] = {k: FEATURE_LABELS.get(k, k) for k in WIN_TREND_FEATURE_NAMES}
    return result


@router.get("/regression-flags")
def get_regression_flags(
    db: Session = Depends(get_db),
):
    """Get players flagged for regression using z-score anomaly detection.

    Display: 'X of 10 flags prove correct within 30 days.'
    """
    season = date.today().year
    return detect_regression_flags(season, db)


@router.get("/upcoming-games")
def get_upcoming_predictions(
    limit: int = Query(10, ge=1, le=30),
    db: Session = Depends(get_db),
):
    """Predict outcomes for upcoming scheduled Cubs games.

    The schedule is pulled live from the MLB Stats API (the games table
    otherwise goes stale for future games). Fetched games are persisted so the
    trained model can build features for them; win probability falls back to a
    home-field baseline only when features can't be built (e.g. no history).
    """
    import logging
    from app.services.ingestion import (
        fetch_schedule, TEAM_ABBR_MAP, parse_mlb_api_games, upsert_games,
    )

    logger = logging.getLogger(__name__)

    # Match live_context: compute "today" in US Central, not naive server time.
    today = datetime.now(timezone(timedelta(hours=-5))).date()

    try:
        raw = fetch_schedule(today, today + timedelta(days=14), team_id=112, game_type="R")
    except Exception as e:
        logger.error(f"Upcoming schedule fetch failed: {e}")
        return {"games": []}

    # Keep only future ("Preview") games, sorted by date, capped at limit.
    upcoming = []
    for g in raw:
        if g.get("status", {}).get("abstractGameState") != "Preview":
            continue
        game_date_str = g.get("officialDate") or g.get("gameDate", "")[:10]
        try:
            gd = date.fromisoformat(game_date_str)
        except (ValueError, TypeError):
            continue
        if gd < today:
            continue
        upcoming.append((gd, g))
    upcoming.sort(key=lambda pair: pair[0])
    upcoming = upcoming[:limit]

    # Persist the fetched games so the feature builders (which look up by
    # game_pk) can run the trained model instead of always hitting the
    # baseline. Non-fatal: on failure we still return the schedule + baseline.
    try:
        upsert_games(parse_mlb_api_games([g for _, g in upcoming], db), db)
    except Exception as e:
        logger.error(f"Persisting upcoming games failed: {e}")
        db.rollback()

    results = []
    for gd, g in upcoming:
        teams = g.get("teams", {})
        home = teams.get("home", {})
        away = teams.get("away", {})
        home_name = home.get("team", {}).get("name", "")
        away_name = away.get("team", {}).get("name", "")
        home_abbr = TEAM_ABBR_MAP.get(home_name, home_name[:3].upper())
        away_abbr = TEAM_ABBR_MAP.get(away_name, away_name[:3].upper())
        is_home = home_abbr == "CHC"
        opp = away_abbr if is_home else home_abbr

        cubs_side = home if is_home else away
        opp_side = away if is_home else home
        cubs_starter = cubs_side.get("probablePitcher", {}).get("fullName") or "TBD"
        opp_starter = opp_side.get("probablePitcher", {}).get("fullName") or "TBD"

        game_pk = g.get("gamePk")

        # Run the trained model on the now-persisted game. build_prediction_features
        # is designed for scheduled games (uses recent completed games); fall back
        # to a home-field baseline only when features truly can't be built.
        win_prob = None
        try:
            features = build_prediction_features(game_pk, db)
            if features is None:
                features = build_game_features(game_pk, db)
            if features is not None:
                win_prob = predict_game_outcome(features).get("win_probability")
        except Exception as e:
            logger.debug(f"Win-prob model failed for game {game_pk}: {e}")
        if win_prob is None:
            win_prob = 0.54 if is_home else 0.46

        results.append({
            "game_pk": game_pk,
            "date": gd.isoformat(),
            "opponent": opp,
            "is_home": is_home,
            "win_probability": win_prob,
            "cubs_starter": cubs_starter,
            "opp_starter": opp_starter,
            "day_night": g.get("dayNight") or "night",
        })

    return {"games": results}


@router.get("/model-status")
def model_status():
    """Get training status and metadata for all ML models."""
    return get_model_status()


@router.get("/feature-importance")
def feature_importance():
    """Get feature importance with plain English labels for display."""
    status = get_model_status()

    game_importance = status["game_outcome"].get("feature_importance", {})
    trend_coefficients = status["win_trend"].get("feature_coefficients", {})

    return {
        "game_outcome": {
            "features": [
                {
                    "name": k,
                    "label": FEATURE_LABELS.get(k, k),
                    "importance": game_importance.get(k, 0),
                }
                for k in GAME_OUTCOME_FEATURE_NAMES
            ],
        },
        "win_trend": {
            "features": [
                {
                    "name": k,
                    "label": FEATURE_LABELS.get(k, k),
                    "coefficient": trend_coefficients.get(k, 0),
                }
                for k in WIN_TREND_FEATURE_NAMES
            ],
        },
    }
