from sqlalchemy import (
    create_engine, Column, Integer, Float, String, Text, Boolean,
    DateTime, Date, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime, timezone

from app.config import get_settings

settings = get_settings()

# Render provides postgres:// but SQLAlchemy requires postgresql://
_db_url = settings.database_url
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)

_engine_kwargs = {"echo": settings.environment == "development"}
if _db_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs["pool_size"] = 5
    _engine_kwargs["max_overflow"] = 10
    _engine_kwargs["pool_pre_ping"] = True

engine = create_engine(_db_url, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Benchmark tables (from spec)
# ---------------------------------------------------------------------------

class Benchmark(Base):
    __tablename__ = "benchmarks"

    id = Column(Integer, primary_key=True)
    season = Column(Integer, nullable=False)
    stat_name = Column(String(50), nullable=False)
    position_group = Column(String(20), nullable=False)  # SP, RP, ALL_HITTERS, C, IF, OF
    mean = Column(Float)
    median = Column(Float)
    p10 = Column(Float)
    p25 = Column(Float)
    p75 = Column(Float)
    p90 = Column(Float)
    sample_size = Column(Integer)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("season", "stat_name", "position_group", name="uq_benchmark"),
        Index("ix_benchmark_season_stat", "season", "stat_name"),
    )


class PitchTypeBenchmark(Base):
    __tablename__ = "pitch_type_benchmarks"

    id = Column(Integer, primary_key=True)
    season = Column(Integer, nullable=False)
    pitch_type = Column(String(10), nullable=False)  # FF, SL, CU, FC, CH, FS, SI
    stat_name = Column(String(50), nullable=False)    # avg_velo, whiff_pct, vert_movement, horiz_break
    mean = Column(Float)
    p25 = Column(Float)
    p75 = Column(Float)
    p90 = Column(Float)
    sample_size = Column(Integer)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("season", "pitch_type", "stat_name", name="uq_pitch_type_benchmark"),
        Index("ix_ptb_season_pitch", "season", "pitch_type"),
    )


class PlayerBenchmark(Base):
    __tablename__ = "player_benchmarks"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, nullable=False)
    stat_name = Column(String(50), nullable=False)
    value = Column(Float)
    percentile = Column(Integer)
    grade = Column(String(15))
    mlb_avg = Column(Float)
    delta = Column(Float)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("player_id", "stat_name", name="uq_player_benchmark"),
        Index("ix_pb_player", "player_id"),
    )


# ---------------------------------------------------------------------------
# Pipeline tracking
# ---------------------------------------------------------------------------

class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id = Column(Integer, primary_key=True)
    pipeline_name = Column(String(50), nullable=False)  # seed_historical, daily_update, etc.
    status = Column(String(20), nullable=False, default="running")  # running, completed, failed
    started_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, nullable=True)
    records_processed = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)  # JSON string for extra context


# ---------------------------------------------------------------------------
# Player data
# ---------------------------------------------------------------------------

class Player(Base):
    __tablename__ = "players"

    id = Column(Integer, primary_key=True)
    mlb_id = Column(Integer, unique=True, nullable=False)
    fg_id = Column(String(20), nullable=True)
    name = Column(String(100), nullable=False)
    team = Column(String(10), nullable=True)
    position = Column(String(10), nullable=True)
    position_group = Column(String(20), nullable=True)  # SP, RP, ALL_HITTERS, C, IF, OF
    is_cubs = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_player_team", "team"),
        Index("ix_player_cubs", "is_cubs"),
    )


# ---------------------------------------------------------------------------
# Game data
# ---------------------------------------------------------------------------

class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True)
    game_pk = Column(Integer, unique=True, nullable=False)  # MLB game ID
    game_date = Column(Date, nullable=False)
    season = Column(Integer, nullable=False)
    home_team = Column(String(10), nullable=False)
    away_team = Column(String(10), nullable=False)
    home_score = Column(Integer, nullable=True)
    away_score = Column(Integer, nullable=True)
    cubs_opponent = Column(String(10), nullable=True)
    cubs_home = Column(Boolean, nullable=True)
    cubs_won = Column(Boolean, nullable=True)
    status = Column(String(20), default="scheduled")  # scheduled, live, final
    day_night = Column(String(10), nullable=True)  # "day" or "night"
    home_starter_id = Column(Integer, nullable=True)
    away_starter_id = Column(Integer, nullable=True)
    statcast_loaded = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_game_date", "game_date"),
        Index("ix_game_season", "season"),
    )


# ---------------------------------------------------------------------------
# Pitching stats (per-game for Cubs pitchers, season aggregates for all)
# ---------------------------------------------------------------------------

class PitcherGameStats(Base):
    __tablename__ = "pitcher_game_stats"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    game_pk = Column(Integer, ForeignKey("games.game_pk"), nullable=True)
    game_date = Column(Date, nullable=False)
    season = Column(Integer, nullable=False)
    ip = Column(Float, default=0)
    hits = Column(Integer, default=0)
    runs = Column(Integer, default=0)
    earned_runs = Column(Integer, default=0)
    walks = Column(Integer, default=0)
    strikeouts = Column(Integer, default=0)
    home_runs = Column(Integer, default=0)
    pitches = Column(Integer, default=0)
    era = Column(Float, nullable=True)
    whip = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_pgs_player_date", "player_id", "game_date"),
    )


class PitcherSeasonStats(Base):
    __tablename__ = "pitcher_season_stats"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    season = Column(Integer, nullable=False)
    team = Column(String(10), nullable=True)
    position_group = Column(String(5), nullable=True)  # SP or RP
    games = Column(Integer, default=0)
    games_started = Column(Integer, default=0)
    ip = Column(Float, default=0)
    era = Column(Float, nullable=True)
    fip = Column(Float, nullable=True)
    xfip = Column(Float, nullable=True)
    xera = Column(Float, nullable=True)
    k_pct = Column(Float, nullable=True)
    bb_pct = Column(Float, nullable=True)
    k_bb_pct = Column(Float, nullable=True)
    swstr_pct = Column(Float, nullable=True)
    csw_pct = Column(Float, nullable=True)
    hard_hit_pct = Column(Float, nullable=True)
    barrel_pct = Column(Float, nullable=True)
    avg_velo = Column(Float, nullable=True)
    whiff_pct = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("player_id", "season", name="uq_pitcher_season"),
        Index("ix_pss_season_team", "season", "team"),
    )


# ---------------------------------------------------------------------------
# Hitting stats
# ---------------------------------------------------------------------------

class HitterGameStats(Base):
    __tablename__ = "hitter_game_stats"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    game_pk = Column(Integer, ForeignKey("games.game_pk"), nullable=True)
    game_date = Column(Date, nullable=False)
    season = Column(Integer, nullable=False)
    ab = Column(Integer, default=0)
    hits = Column(Integer, default=0)
    doubles = Column(Integer, default=0)
    triples = Column(Integer, default=0)
    home_runs = Column(Integer, default=0)
    rbi = Column(Integer, default=0)
    walks = Column(Integer, default=0)
    strikeouts = Column(Integer, default=0)
    stolen_bases = Column(Integer, default=0)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_hgs_player_date", "player_id", "game_date"),
    )


class HitterSeasonStats(Base):
    __tablename__ = "hitter_season_stats"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    season = Column(Integer, nullable=False)
    team = Column(String(10), nullable=True)
    position_group = Column(String(20), nullable=True)
    games = Column(Integer, default=0)
    pa = Column(Integer, default=0)
    ab = Column(Integer, default=0)
    avg = Column(Float, nullable=True)
    obp = Column(Float, nullable=True)
    slg = Column(Float, nullable=True)
    wrc_plus = Column(Float, nullable=True)
    woba = Column(Float, nullable=True)
    xba = Column(Float, nullable=True)
    xslg = Column(Float, nullable=True)
    xwoba = Column(Float, nullable=True)
    barrel_pct = Column(Float, nullable=True)
    hard_hit_pct = Column(Float, nullable=True)
    avg_exit_velo = Column(Float, nullable=True)
    o_swing_pct = Column(Float, nullable=True)
    z_contact_pct = Column(Float, nullable=True)
    chase_rate = Column(Float, nullable=True)
    sprint_speed = Column(Float, nullable=True)
    bsr = Column(Float, nullable=True)
    babip = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("player_id", "season", name="uq_hitter_season"),
        Index("ix_hss_season_team", "season", "team"),
    )


# ---------------------------------------------------------------------------
# Defense stats
# ---------------------------------------------------------------------------

class DefenseSeasonStats(Base):
    __tablename__ = "defense_season_stats"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    season = Column(Integer, nullable=False)
    team = Column(String(10), nullable=True)
    position = Column(String(10), nullable=True)
    oaa = Column(Float, nullable=True)
    drs = Column(Float, nullable=True)
    framing_runs = Column(Float, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("player_id", "season", name="uq_defense_season"),
    )


# ---------------------------------------------------------------------------
# Statcast pitch-level data (for pitch-type benchmarks and arsenal analysis)
# ---------------------------------------------------------------------------

class StatcastPitch(Base):
    __tablename__ = "statcast_pitches"

    id = Column(Integer, primary_key=True)
    game_pk = Column(Integer, nullable=True)
    game_date = Column(Date, nullable=False)
    season = Column(Integer, nullable=False)
    pitcher_id = Column(Integer, nullable=False)
    batter_id = Column(Integer, nullable=False)
    pitch_type = Column(String(10), nullable=True)
    release_speed = Column(Float, nullable=True)
    pfx_x = Column(Float, nullable=True)       # horizontal movement
    pfx_z = Column(Float, nullable=True)       # vertical movement
    plate_x = Column(Float, nullable=True)
    plate_z = Column(Float, nullable=True)
    launch_speed = Column(Float, nullable=True)
    launch_angle = Column(Float, nullable=True)
    events = Column(String(50), nullable=True)
    description = Column(String(50), nullable=True)  # called_strike, swinging_strike, ball, etc.
    zone = Column(Integer, nullable=True)
    spin_rate = Column(Float, nullable=True)
    is_whiff = Column(Boolean, default=False)
    is_barrel = Column(Boolean, default=False)
    is_hard_hit = Column(Boolean, default=False)

    __table_args__ = (
        Index("ix_sc_pitcher_date", "pitcher_id", "game_date"),
        Index("ix_sc_game", "game_pk"),
        Index("ix_sc_pitch_type", "pitch_type", "season"),
    )


# ---------------------------------------------------------------------------
# Team aggregate stats (rolling, for ML features and dashboard)
# ---------------------------------------------------------------------------

class TeamSeasonStats(Base):
    __tablename__ = "team_season_stats"

    id = Column(Integer, primary_key=True)
    team = Column(String(10), nullable=False)
    season = Column(Integer, nullable=False)
    games_played = Column(Integer, default=0)
    wins = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    runs_scored = Column(Integer, default=0)
    runs_allowed = Column(Integer, default=0)
    team_era = Column(Float, nullable=True)
    team_fip = Column(Float, nullable=True)
    team_wrc_plus = Column(Float, nullable=True)
    team_woba = Column(Float, nullable=True)
    team_k_pct = Column(Float, nullable=True)
    team_bb_pct = Column(Float, nullable=True)
    team_hard_hit_pct = Column(Float, nullable=True)
    team_barrel_pct = Column(Float, nullable=True)
    pythag_wins = Column(Float, nullable=True)
    pythag_losses = Column(Float, nullable=True)
    run_diff = Column(Integer, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("team", "season", name="uq_team_season"),
    )


# ---------------------------------------------------------------------------
# Divergence alerts
# ---------------------------------------------------------------------------

class DivergenceAlert(Base):
    __tablename__ = "divergence_alerts"

    id = Column(Integer, primary_key=True)
    player_id = Column(Integer, ForeignKey("players.mlb_id"), nullable=False)
    alert_type = Column(String(30), nullable=False)  # BREAKOUT, REGRESS, WATCH, INJURY
    stat1_name = Column(String(50), nullable=False)
    stat1_value = Column(Float, nullable=False)
    stat1_percentile = Column(Integer, nullable=True)
    stat2_name = Column(String(50), nullable=False)
    stat2_value = Column(Float, nullable=False)
    stat2_percentile = Column(Integer, nullable=True)
    gap = Column(Float, nullable=False)
    explanation = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_da_player_active", "player_id", "is_active"),
    )


# ---------------------------------------------------------------------------
# Editorials (Claude-generated analysis)
# ---------------------------------------------------------------------------

class Editorial(Base):
    __tablename__ = "editorials"

    id = Column(Integer, primary_key=True)
    editorial_type = Column(String(30), nullable=False)  # daily_takeaway, weekly_state, player_spotlight, prediction_recap
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    summary = Column(String(500), nullable=True)
    player_ids = Column(Text, nullable=True)  # JSON list of referenced player IDs
    stat_references = Column(Text, nullable=True)  # JSON list of {stat, value, percentile}
    game_pk = Column(Integer, nullable=True)  # Associated game (for daily_takeaway)
    season = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        Index("ix_ed_type_date", "editorial_type", "created_at"),
        Index("ix_ed_season", "season"),
    )


# ---------------------------------------------------------------------------
# ML Model Status (persisted to DB instead of filesystem)
# ---------------------------------------------------------------------------

class ModelStatus(Base):
    __tablename__ = "model_status"

    id = Column(Integer, primary_key=True)
    model_name = Column(String(50), unique=True, nullable=False)
    status = Column(String(20), nullable=False, default="active")
    accuracy = Column(Float, nullable=True)
    accuracy_label = Column(String(50), nullable=True)
    training_samples = Column(Integer, default=0)
    feature_importance = Column(Text, nullable=True)  # JSON
    trained_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class TeamStrength(Base):
    """Current season strength ratings for all 30 MLB teams.
    Used by ML model for opponent strength feature.
    """
    __tablename__ = "team_strength"

    id = Column(Integer, primary_key=True)
    team_abbrev = Column(String(10), nullable=False)
    season = Column(Integer, nullable=False)
    wins = Column(Integer, default=0)
    losses = Column(Integer, default=0)
    win_pct = Column(Float, default=0.500)
    pythag_wpct = Column(Float, default=0.500)
    runs_scored = Column(Integer, default=0)
    runs_allowed = Column(Integer, default=0)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("team_abbrev", "season", name="uq_team_strength"),
    )


class TrainedModel(Base):
    """Stores serialized ML model binaries in the database.
    Survives Render deploys (ephemeral filesystem gets wiped, DB persists).
    """
    __tablename__ = "trained_models"

    id = Column(Integer, primary_key=True)
    model_name = Column(String(50), unique=True, nullable=False)  # game_outcome, win_trend
    model_data = Column(Text, nullable=False)  # base64-encoded joblib bytes
    metadata_json = Column(Text, nullable=True)  # JSON with accuracy, features, etc.
    trained_at = Column(DateTime, default=utcnow)


# ---------------------------------------------------------------------------
# Create all tables
# ---------------------------------------------------------------------------

def _sync_columns():
    """Idempotently add model columns that are missing from existing tables.

    create_all() creates missing tables but never alters existing ones, so a
    database created before a column was added to its model drifts out of sync
    (e.g. games.day_night, whose absence 500s any query loading the Game
    entity). This adds each missing column as a nullable ALTER TABLE ADD
    COLUMN. Additive only — it never drops or alters existing columns, and is a
    no-op once the schema is in sync (so it's safe on an already-correct DB).
    """
    import logging
    from sqlalchemy import inspect, text

    logger = logging.getLogger(__name__)
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    prep = engine.dialect.identifier_preparer

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all already made it with the full schema
        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in existing_cols:
                continue
            col_type = col.type.compile(dialect=engine.dialect)
            ddl = (
                f"ALTER TABLE {prep.quote(table.name)} "
                f"ADD COLUMN {prep.quote(col.name)} {col_type}"
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                logger.warning(f"Schema sync: added missing column {table.name}.{col.name}")
            except Exception as e:
                logger.error(f"Schema sync failed for {table.name}.{col.name}: {e}")


def init_db():
    Base.metadata.create_all(bind=engine)
    _sync_columns()
