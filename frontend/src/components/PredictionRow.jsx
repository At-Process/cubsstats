/**
 * Game prediction row with Cubs win probability and favorability indicator.
 */
export default function PredictionRow({
  opponent,
  date,
  isHome,
  winProbability,
  status,
  cubsStarter,
  oppStarter,
  dayNight,
}) {
  const isModelReady = status !== 'model_not_trained' && winProbability != null
  const pct = isModelReady ? (winProbability * 100).toFixed(0) : null
  const pctNum = pct ? parseFloat(pct) : null

  // Thresholds align with getFavorLabel below (FAVORED >=55, TOSS-UP 45-54,
  // UNDERDOG <45) so the win% color never contradicts the badge.
  const getProbColor = (p) => {
    if (p == null) return '#8892A8'
    if (p >= 60) return '#34D399'   // strong favorite
    if (p >= 55) return '#6EE7B7'   // favored
    if (p >= 45) return '#8892A8'   // toss-up (gray)
    if (p >= 40) return '#FBBF24'   // underdog
    return '#F87171'                // heavy underdog
  }

  const getFavorLabel = (p) => {
    if (p == null) return null
    if (p >= 55) return { text: 'FAVORED', color: '#34D399', bg: 'rgba(52,211,153,0.15)' }
    if (p >= 45) return { text: 'TOSS-UP', color: '#E8ECF4', bg: 'rgba(255,255,255,0.10)' }
    return { text: 'UNDERDOG', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' }
  }

  const favor = getFavorLabel(pctNum)

  const hasStarters = cubsStarter && oppStarter && cubsStarter !== 'TBD' && oppStarter !== 'TBD'

  return (
    <div className="py-2.5 border-b border-white-8 last:border-b-0 hover:bg-surface-hover/50 transition-colors rounded">
      <div className="flex items-center gap-2 md:gap-3">
        {/* Date */}
        <span
          className="text-[10px] text-text-secondary w-[55px] md:w-[60px]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {date}
        </span>

        {/* Matchup */}
        <div className="flex items-center gap-1 w-[75px] md:w-[90px]">
          <span className="text-[10px] text-text-secondary">
            {isHome ? 'vs' : '@'}
          </span>
          <span
            className="text-sm font-semibold text-text-primary"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {opponent}
          </span>
        </div>

        {/* Win probability bar */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-[6px] rounded-full bg-surface-hover overflow-hidden">
            {isModelReady && (
              <div
                className="h-full rounded-full animate-bar-fill"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${getProbColor(pctNum)}, ${getProbColor(pctNum)}55)`,
                }}
              />
            )}
          </div>

          {/* Cubs win probability — explicitly labeled */}
          <span
            className="text-[12px] font-bold w-[65px] text-right"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: isModelReady ? getProbColor(pctNum) : '#8892A8',
            }}
          >
            {isModelReady ? `Cubs ${pct}%` : '—'}
          </span>
        </div>

        {/* Favorability indicator */}
        {favor && (
          <span
            className="hidden md:inline-block text-[8px] md:text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wider w-[62px] text-center"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: favor.color,
              backgroundColor: favor.bg,
            }}
          >
            {favor.text}
          </span>
        )}

        {/* Home + Day/Night indicators — hidden on mobile to save space */}
        <div className="hidden md:flex items-center gap-1">
          {isHome && (
            <span
              className="text-[8px] px-1.5 py-0.5 rounded bg-cubs-blue/20 text-accent-blue"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              HOME
            </span>
          )}
          {dayNight && (
            <span
              className="text-[8px] px-1.5 py-0.5 rounded font-medium"
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                backgroundColor: dayNight === 'day' ? 'rgba(251,191,36,0.18)' : 'rgba(96,165,250,0.15)',
                color: dayNight === 'day' ? '#FBBF24' : '#60A5FA',
              }}
            >
              {dayNight === 'day' ? 'DAY' : 'NIGHT'}
            </span>
          )}
        </div>
      </div>

      {/* Starter matchup line — hidden on mobile */}
      {hasStarters && (
        <div className="hidden md:block ml-[60px] mt-0.5">
          <span
            className="text-[10px] text-text-secondary"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {cubsStarter} vs {oppStarter}
          </span>
        </div>
      )}
    </div>
  )
}
