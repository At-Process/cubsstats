import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useBenchmarks } from '../hooks/useBenchmarks'
import { formatStat, formatRecord, formatDelta, ordinal, STAT_EXPLANATIONS } from '../utils/formatting'
import { gradeFromPercentile, LOWER_IS_BETTER } from '../utils/grading'
import GradingLegend from '../components/GradingLegend'
import LiveTicker from '../components/LiveTicker'
import MetricCard from '../components/MetricCard'
import WinTrendChart from '../components/WinTrendChart'
import DivergenceAlert from '../components/DivergenceAlert'
import PredictionRow from '../components/PredictionRow'
import PlayerStatRow from '../components/PlayerStatRow'
import PercentileBar from '../components/PercentileBar'
import GradeBadge from '../components/GradeBadge'
import EditorialFeed from '../components/EditorialFeed'

// ---------------------------------------------------------------------------
// Benchmark-aware metric helpers
// ---------------------------------------------------------------------------

/** Compute a percentile for a team stat from benchmark breakpoints. */
function teamPercentile(value, bench, lowerIsBetter) {
  if (value == null || !bench) return null
  const pts = [
    [bench.p10, 10], [bench.p25, 25], [bench.median, 50],
    [bench.p75, 75], [bench.p90, 90],
  ].filter(([v]) => v != null)

  if (!pts.length) return 50

  if (lowerIsBetter) {
    // Invert: low value = high percentile
    const inverted = pts.map(([v, p]) => [v, 100 - p]).sort((a, b) => a[0] - b[0])
    return interpolate(value, inverted)
  }
  pts.sort((a, b) => a[0] - b[0])
  return interpolate(value, pts)
}

function interpolate(value, pts) {
  if (value <= pts[0][0]) return Math.max(1, pts[0][1])
  if (value >= pts[pts.length - 1][0]) return Math.min(99, pts[pts.length - 1][1])
  for (let i = 0; i < pts.length - 1; i++) {
    const [vLo, pLo] = pts[i]
    const [vHi, pHi] = pts[i + 1]
    if (value >= vLo && value <= vHi) {
      if (vHi === vLo) return Math.round((pLo + pHi) / 2)
      const frac = (value - vLo) / (vHi - vLo)
      return Math.max(1, Math.min(99, Math.round(pLo + frac * (pHi - pLo))))
    }
  }
  return 50
}

// ---------------------------------------------------------------------------
// Section: Top Metrics Row
// ---------------------------------------------------------------------------

function TopMetrics({ teamStats, record, getBenchmark }) {
  // Each card: { label, plainEnglish, value, statName, positionGroup, min, max, lowerIsBetter }
  const cards = useMemo(() => {
    if (!teamStats && !record) return []

    const wins = record?.wins ?? 0
    const losses = record?.losses ?? 0
    const pythW = record?.pythag_wins
    const pythL = record?.pythag_losses
    const gp = record?.games_played ?? 0

    return [
      {
        label: 'Record',
        plainEnglish: `${gp} games played this season`,
        value: null,
        displayValue: formatRecord(wins, losses),
        statName: 'record',
        subtitle: gp ? `Win%: ${((wins / gp) * 100).toFixed(1)}%` : null,
        percentile: gp ? Math.round((wins / gp) * 100) : null,
        min: 0, max: 100,
      },
      {
        label: 'Expected Record',
        plainEnglish: 'Based on runs scored vs allowed',
        value: null,
        displayValue: pythW != null ? `${Math.round(pythW)}-${Math.round(pythL)}` : '—',
        statName: 'pythag',
        subtitle: record?.run_diff != null ? `Run Margin: ${formatDelta(record.run_diff, 0)}` : null,
        percentile: gp && pythW != null ? Math.round((pythW / gp) * 100) : null,
        min: 0, max: 100,
      },
      {
        label: 'Hitting Power',
        plainEnglish: 'League-adjusted value, 100 = average',
        value: teamStats?.team_wrc_plus,
        statName: 'wrc_plus',
        positionGroup: 'ALL_HITTERS',
        min: 70, max: 130,
        lowerIsBetter: false,
      },
      {
        label: 'True Pitching Quality',
        plainEnglish: 'ERA removing luck and defense (FIP)',
        value: teamStats?.team_fip,
        statName: 'fip',
        positionGroup: 'SP',
        min: 2.5, max: 6.0,
        lowerIsBetter: true,
      },
      {
        label: 'Run Margin',
        plainEnglish: 'Runs scored minus runs allowed',
        value: teamStats?.run_diff ?? record?.run_diff,
        statName: 'run_diff',
        min: -150, max: 150,
        lowerIsBetter: false,
      },
    ]
  }, [teamStats, record])

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-3">
      {cards.map((card) => {
        // Look up benchmark for stats that have them
        const bench = card.positionGroup
          ? getBenchmark(card.statName, card.positionGroup)
          : null
        const mlbAvg = bench?.mean ?? null
        const lib = card.lowerIsBetter ?? false
        const pctile = card.percentile ??
          (card.value != null && bench ? teamPercentile(card.value, bench, lib) : null)

        return (
          <MetricCard
            key={card.label}
            label={card.label}
            plainEnglish={card.plainEnglish}
            value={card.displayValue !== undefined ? card.displayValue : card.value}
            mlbAvg={mlbAvg}
            percentile={pctile}
            grade={pctile != null ? gradeFromPercentile(pctile).label : null}
            subtitle={card.subtitle}
            min={card.min}
            max={card.max}
            lowerIsBetter={lib}
            statName={card.statName}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Divergence Alerts Panel
// ---------------------------------------------------------------------------

function DivergencePanel({ divergences, loading, injuries }) {
  const [showIL, setShowIL] = useState(false)
  const ilCount = injuries?.length || 0

  return (
    <div className="bg-surface rounded-lg border border-white-8 p-4 flex flex-col card-elevated">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        <h3
          className="text-[12px] uppercase tracking-widest text-text-secondary"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          DIVERGENCE ALERTS
        </h3>
        {ilCount > 0 && (
          <button
            onClick={() => setShowIL(!showIL)}
            className="text-[8px] font-bold px-1.5 py-0.5 rounded cursor-pointer hover:brightness-125 transition-all"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: '#F87171',
              backgroundColor: 'rgba(248,113,113,0.15)',
            }}
          >
            {ilCount} on IL {showIL ? '▾' : '▸'}
          </button>
        )}
      </div>

      {/* Expandable IL list */}
      {showIL && injuries?.length > 0 && (
        <div className="mb-3 p-2.5 rounded-lg border border-white-8 bg-navy/50">
          <div className="flex flex-wrap gap-x-2 md:gap-x-4 gap-y-1">
            {injuries.map((inj, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400" />
                <span className="text-[10px] text-text-primary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  {inj.player_name}
                </span>
                <span className="text-[9px] text-text-secondary">
                  {inj.injury_type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <Shimmer lines={3} />
      ) : !divergences?.length ? (
        <p className="text-sm text-text-secondary italic flex-1 flex items-center">
          No active divergences detected. All Cubs player stats are tracking their expected values.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {divergences.slice(0, 6).map((d) => (
            <DivergenceAlert
              key={d.id}
              alertType={d.alert_type}
              playerName={d.player_name}
              stat1Name={d.stat1_name}
              stat1Value={formatStat(d.stat1_value, d.stat1_name)}
              stat1Percentile={d.stat1_percentile}
              stat2Name={d.stat2_name}
              stat2Value={formatStat(d.stat2_value, d.stat2_name)}
              stat2Percentile={d.stat2_percentile}
              explanation={d.explanation}
            />
          ))}
          {divergences.length > 6 && (
            <Link to="/divergences" className="text-[10px] text-accent-blue hover:underline text-center py-1">
              View all {divergences.length} alerts →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Game Predictions Panel
// ---------------------------------------------------------------------------

function PredictionsPanel({ upcomingPredictions, loading }) {
  const games = upcomingPredictions?.games || []

  return (
    <div className="bg-surface rounded-lg border border-white-8 p-4 flex flex-col card-elevated">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
          <h3
            className="text-[12px] uppercase tracking-widest text-text-secondary"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            GAME PREDICTIONS
          </h3>
        </div>
        <span className="text-[9px] text-text-secondary italic">
          Live from MLB
        </span>
      </div>

      {/* Legend */}
      <p className="text-[9px] text-text-secondary mb-2">
        Cubs win probability —{' '}
        <span style={{ color: '#34D399' }}>green</span> = favored,{' '}
        <span style={{ color: '#8892A8' }}>gray</span> = toss-up,{' '}
        <span style={{ color: '#FBBF24' }}>amber</span> = underdog
      </p>

      {/* Baselines row */}
      <div className="flex items-center gap-4 mb-3 pb-2 border-b border-white-8">
        <BaselinePill label="Coin flip" value="50%" />
        <BaselinePill label="Home adv" value="54%" />
        <BaselinePill label="Model" value={games.length && games[0].win_probability != null
          ? `Cubs ${(games[0].win_probability * 100).toFixed(0)}%` : 'Active'} accent />
      </div>

      {loading ? (
        <Shimmer lines={4} />
      ) : !games.length ? (
        <p className="text-sm text-text-secondary italic flex-1 flex items-center">
          No upcoming games scheduled.
        </p>
      ) : (
        <div className="flex flex-col">
          {games.map((g) => (
            <PredictionRow
              key={g.game_pk}
              opponent={g.opponent}
              date={g.date}
              isHome={g.is_home}
              winProbability={g.win_probability}
              status="active"
              cubsStarter={g.cubs_starter}
              oppStarter={g.opp_starter}
              dayNight={g.day_night}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BaselinePill({ label, value, accent }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-text-secondary">{label}:</span>
      <span
        className="text-[11px] font-bold"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: accent ? '#60A5FA' : '#E8ECF4',
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Pitching Summary (Actual vs True ERA)
// ---------------------------------------------------------------------------

function PitchingSummary({ pitchers, getBenchmark, loading }) {
  const spBench = getBenchmark('era', 'SP')
  const fipBench = getBenchmark('fip', 'SP')

  const sortedPitchers = useMemo(() => {
    if (!pitchers?.length) return []
    return [...pitchers]
      .filter((p) => p.ip >= 10)
      .sort((a, b) => (b.ip || 0) - (a.ip || 0))
      .slice(0, 6)
  }, [pitchers])

  return (
    <div className="bg-surface rounded-lg border border-white-8 p-4 card-elevated">
      <h3
        className="text-[11px] uppercase tracking-widest text-text-secondary mb-1"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        ACTUAL VS TRUE ERA
      </h3>
      <p className="text-[10px] text-accent-blue italic mb-3">
        Big gaps between ERA and True Pitching Quality mean luck will run out
      </p>

      {loading ? (
        <Shimmer lines={5} />
      ) : !sortedPitchers.length ? (
        <p className="text-sm text-text-secondary italic">No pitching data available</p>
      ) : (
        <div className="overflow-x-auto">
          {/* Column headers */}
          <div className="flex items-center gap-3 pb-1 mb-1 border-b border-white-8 min-w-[380px]">
            <span className="text-[9px] uppercase text-text-secondary w-[100px] md:w-[140px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>Pitcher</span>
            <span className="text-[9px] uppercase text-text-secondary w-[70px] md:w-[90px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>ERA</span>
            <span className="text-[9px] uppercase text-text-secondary w-[70px] md:w-[90px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>True ERA</span>
            <span className="text-[9px] uppercase text-text-secondary flex-1"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>Gap</span>
          </div>

          {sortedPitchers.map((p) => {
            const eraPctile = p.era != null && spBench
              ? teamPercentile(p.era, spBench, true) : null
            const fipPctile = p.fip != null && fipBench
              ? teamPercentile(p.fip, fipBench, true) : null
            const gap = p.era != null && p.fip != null ? p.era - p.fip : null
            const gapColor = gap != null
              ? gap < -0.5 ? '#34D399' : gap > 0.5 ? '#F87171' : '#8892A8'
              : '#8892A8'

            return (
              <PlayerStatRow
                key={p.player_id}
                name={playerName(p)}
                stat1={p.era != null ? p.era.toFixed(2) : '—'}
                stat1Pctile={eraPctile}
                stat2={p.fip != null ? p.fip.toFixed(2) : '—'}
                stat2Pctile={fipPctile}
                barFill={gap != null ? Math.min(100, Math.abs(gap) * 40 + 10) : 0}
                barColor={gapColor}
                explanation={gap != null
                  ? Math.abs(gap) >= 0.5
                    ? `Gap of ${Math.abs(gap).toFixed(2)} — ${gap > 0 ? 'Actual ERA may drop: true pitching quality is better than results show' : 'Actual ERA may rise: luck or defense has been masking true performance'}`
                    : `ERA and True ERA aligned — stable, reliable performance`
                  : null
                }
              />
            )
          })}

          {/* MLB avg footer */}
          {spBench && (
            <div className="mt-2 pt-2 border-t border-white-8 flex items-center gap-4">
              <span className="text-[9px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                MLB avg ERA: {spBench.mean?.toFixed(2)}
              </span>
              {fipBench && (
                <span className="text-[9px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                  MLB avg True ERA: {fipBench.mean?.toFixed(2)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Hitting Summary (Expected vs Actual Hitting)
// ---------------------------------------------------------------------------

function HittingSummary({ hitters, getBenchmark, loading }) {
  // Use wOBA vs OBP as "actual vs expected" when xwOBA unavailable
  // OBP is a solid proxy — it captures on-base value without batted-ball luck
  const sortedHitters = useMemo(() => {
    if (!hitters?.length) return []
    return [...hitters]
      .filter((h) => h.pa >= 20)
      .sort((a, b) => (b.pa || 0) - (a.pa || 0))
      .slice(0, 6)
  }, [hitters])

  return (
    <div className="bg-surface rounded-lg border border-white-8 p-4 card-elevated">
      <h3
        className="text-[11px] uppercase tracking-widest text-text-secondary mb-1"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        BATTING: AVG VS ON-BASE
      </h3>
      <p className="text-[10px] text-accent-blue italic mb-3">
        Batting average vs on-base percentage — OBP adds walks and shows true plate discipline
      </p>

      {loading ? (
        <Shimmer lines={5} />
      ) : !sortedHitters.length ? (
        <p className="text-sm text-text-secondary italic">No hitting data available</p>
      ) : (
        <div className="overflow-x-auto">
          {/* Column headers */}
          <div className="flex items-center gap-3 pb-1 mb-1 border-b border-white-8 min-w-[380px]">
            <span className="text-[9px] uppercase text-text-secondary w-[100px] md:w-[140px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>Hitter</span>
            <span className="text-[9px] uppercase text-text-secondary w-[70px] md:w-[90px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>AVG</span>
            <span className="text-[9px] uppercase text-text-secondary w-[70px] md:w-[90px]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>OBP</span>
            <span className="text-[9px] uppercase text-text-secondary flex-1"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>wOBA</span>
          </div>

          {sortedHitters.map((h) => {
            const avg = h.avg
            const obp = h.obp
            const woba = h.woba
            // OBP-AVG gap shows plate discipline (walks)
            const gap = avg != null && obp != null ? obp - avg : null
            const gapColor = woba != null
              ? woba > 0.340 ? '#34D399' : woba > 0.310 ? '#6EE7B7' : woba > 0.290 ? '#8892A8' : '#FBBF24'
              : '#8892A8'

            return (
              <PlayerStatRow
                key={h.player_id}
                name={playerName(h)}
                stat1={avg != null ? avg.toFixed(3).replace(/^0/, '') : '—'}
                stat1Pctile={null}
                stat2={obp != null ? obp.toFixed(3).replace(/^0/, '') : '—'}
                stat2Pctile={null}
                barFill={woba != null ? Math.min(100, woba * 250) : 0}
                barColor={gapColor}
                explanation={woba != null
                  ? `wOBA: ${woba.toFixed(3).replace(/^0/, '')} — ${woba > 0.340 ? 'elite production' : woba > 0.310 ? 'above average' : woba > 0.290 ? 'average' : 'below average production'}`
                  : null
                }
              />
            )
          })}

          <div className="mt-2 pt-2 border-t border-white-8 flex items-center gap-4">
            <span className="text-[9px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              MLB avg AVG: .248
            </span>
            <span className="text-[9px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              MLB avg OBP: .315
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Defense & Model Quality
// ---------------------------------------------------------------------------

function DefenseModelPanel({ teamStats, loading, standings }) {
  const defenseStats = [
    { label: 'Team ERA', value: teamStats?.team_era, statName: 'era' },
    { label: 'True Pitching Quality', value: teamStats?.team_fip, statName: 'fip' },
    { label: 'Team Strikeout Rate', value: teamStats?.team_k_pct, statName: 'k_pct' },
    { label: 'Team Walk Rate', value: teamStats?.team_bb_pct, statName: 'bb_pct' },
    { label: 'Runs Scored', value: teamStats?.runs_scored, statName: 'runs_scored' },
    { label: 'Runs Allowed', value: teamStats?.runs_allowed, statName: 'runs_allowed' },
  ]

  return (
    <div className="bg-surface rounded-lg border border-white-8 p-4 card-elevated">
      <h3
        className="text-[11px] uppercase tracking-widest text-text-secondary mb-3"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        TEAM STATS & STANDINGS
      </h3>

      {loading ? (
        <Shimmer lines={5} />
      ) : (
        <>
          {/* Team defense stats */}
          <div className="mb-4">
            <h4 className="text-[9px] uppercase text-text-secondary tracking-wide mb-2"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Team Pitching Metrics
            </h4>
            {defenseStats.map((s) => (
              <div key={s.label} className="flex items-center justify-between py-1">
                <span className="text-[10px] text-text-secondary">{s.label}</span>
                <span
                  className="text-[12px] font-semibold text-text-primary"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {s.value != null ? formatStat(s.value, s.statName) : '—'}
                </span>
              </div>
            ))}
          </div>

          {/* NL Central Standings */}
          {standings?.length > 0 && (
            <div className="pt-3 border-t border-white-8">
              <h4 className="text-[9px] uppercase text-text-secondary tracking-wide mb-2"
                style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                NL Central
              </h4>
              {/* Column headers */}
              <div className="flex items-center justify-between py-0.5 mb-0.5" style={{ paddingLeft: 8 }}>
                <span className="text-[9px] text-text-secondary w-[32px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>Team</span>
                <span className="text-[9px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>W-L</span>
                <span className="text-[9px] text-text-secondary w-[30px] text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>GB</span>
              </div>
              {standings.map((s) => (
                <div
                  key={s.abbrev}
                  className="flex items-center justify-between py-0.5"
                  style={s.abbrev === 'CHC' ? { borderLeft: '2px solid #0E3386', paddingLeft: 6 } : { paddingLeft: 8 }}
                >
                  <span
                    className="text-[11px] text-text-primary w-[32px]"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: s.abbrev === 'CHC' ? 700 : 400,
                    }}
                  >
                    {s.abbrev}
                  </span>
                  <span className="text-[11px] text-text-secondary" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {s.wins}-{s.losses}
                  </span>
                  <span className="text-[11px] text-text-secondary w-[30px] text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                    {s.games_back === '-' ? '--' : s.games_back}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get player name — enriched endpoints include a name field */
function playerName(player) {
  return player.name || `#${player.player_id}`
}

function Shimmer({ lines = 3 }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded bg-surface-hover animate-pulse"
          style={{ width: `${70 + Math.random() * 30}%` }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section: Win Trend summary builder
// ---------------------------------------------------------------------------

function buildWinTrendSummary(record, teamStats) {
  if (!record?.wins && !teamStats) return null
  const parts = []
  if (record?.wins != null) {
    parts.push(`The Cubs are ${record.wins}-${record.losses}`)
  }
  if (record?.pythag_wins != null) {
    const diff = record.wins - record.pythag_wins
    if (Math.abs(diff) >= 1) {
      parts.push(
        diff > 0
          ? `outperforming their Pythagorean expectation by ${diff.toFixed(1)} wins — some luck involved`
          : `underperforming their Pythagorean expectation by ${Math.abs(diff).toFixed(1)} wins — due for positive regression`
      )
    } else {
      parts.push('right on pace with their Pythagorean expectation')
    }
  }
  if (record?.run_diff != null) {
    parts.push(
      `with a run differential of ${record.run_diff > 0 ? '+' : ''}${record.run_diff}`
    )
  }
  return parts.join(', ') + '.'
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard() {
  // Data fetches
  const { data: teamStats, loading: teamLoading } = useApi('/team/stats')
  const { data: record, loading: recordLoading } = useApi('/team/record')
  const { data: winTrend, loading: trendLoading } = useApi('/team/win-trend')
  const { data: divergences, loading: divLoading } = useApi('/divergences/enriched')
  const { data: upcomingPredictions, loading: predLoading } = useApi('/predictions/upcoming-games')
  const { data: cubsPitching, loading: pitchLoading } = useApi('/pitching/cubs/enriched')
  const { data: cubsHitting, loading: hitLoading } = useApi('/hitting/cubs/enriched')
  const { getBenchmark, loading: benchLoading } = useBenchmarks()
  const { data: liveContext } = useApi('/team/live-context')

  const isLoading = teamLoading || recordLoading || benchLoading

  const { data: editorialsData } = useApi('/editorials?limit=3')

  const editorialItems = useMemo(() => {
    const eds = editorialsData?.editorials || []
    if (eds.length) {
      const typeColors = {
        daily_takeaway: '#60A5FA', weekly_state: '#A78BFA',
        player_spotlight: '#34D399', prediction_recap: '#FBBF24',
      }
      return eds.map(e => ({
        title: e.title,
        body: e.summary || e.body?.slice(0, 200),
        category: e.editorial_type?.replace('_', ' ').toUpperCase(),
        timestamp: e.created_at ? new Date(e.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) : null,
        accentColor: typeColors[e.editorial_type] || '#60A5FA',
      }))
    }
    // Fallback: build from divergences when no editorials exist
    if (!divergences?.length) return []
    return divergences.slice(0, 3).map((d) => ({
      title: `${d.player_name}: ${d.stat1_name} vs ${d.stat2_name}`,
      body: d.explanation,
      category: d.alert_type,
      accentColor:
        d.alert_type === 'BREAKOUT' ? '#34D399'
        : d.alert_type === 'REGRESS' ? '#F87171'
        : '#FBBF24',
    }))
  }, [editorialsData, divergences])

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Grading Legend */}
      <GradingLegend />

      {/* 1.5. Live Ticker */}
      <LiveTicker liveContext={liveContext} />

      {/* 2. Top Metrics Row (5-col) */}
      <TopMetrics
        teamStats={teamStats}
        record={record}
        getBenchmark={getBenchmark}
      />

      {/* 3. Win Trend Chart */}
      <WinTrendChart
        data={winTrend || []}
        summary={buildWinTrendSummary(record, teamStats)}
      />

      {/* 4. Middle Row (2-col): Divergences + Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DivergencePanel
          divergences={divergences}
          loading={divLoading}
          injuries={liveContext?.injuries}
        />
        <PredictionsPanel
          upcomingPredictions={upcomingPredictions}
          loading={predLoading}
        />
      </div>

      {/* 5. Bottom Row (3-col): Pitching + Hitting + Defense */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <PitchingSummary
          pitchers={cubsPitching}
          getBenchmark={getBenchmark}
          loading={pitchLoading || benchLoading}
        />
        <HittingSummary
          hitters={cubsHitting}
          getBenchmark={getBenchmark}
          loading={hitLoading || benchLoading}
        />
        <DefenseModelPanel
          teamStats={teamStats}
          loading={teamLoading}
          standings={liveContext?.standings}
        />
      </div>

      {/* 6. Latest from the Analyst */}
      <div className="bg-surface rounded-lg border border-white-8 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3
            className="text-[11px] uppercase tracking-widest text-text-secondary"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            LATEST FROM THE ANALYST
          </h3>
          <Link
            to="/editorial"
            className="text-[10px] text-accent-blue hover:underline"
          >
            View all editorials →
          </Link>
        </div>
        <EditorialFeed items={editorialItems} />
      </div>
    </div>
  )
}
