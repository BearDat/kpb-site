import React from 'react';
import { TeamMark, TeamLink, formatGameDate, formatGameTime, roundLabel } from './primitives';

function Side({ team, score, isWinner, decided }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="w-1 self-stretch flex-shrink-0" style={{ background: team ? (team.color || '#0C2340') : 'transparent' }} />
      <TeamMark team={team} size={22} />
      <TeamLink
        team={team}
        className={`flex-1 min-w-0 truncate text-sm ${decided && !isWinner ? 'text-ink-mute' : 'text-ink font-medium'}`}
      />
      {score != null && (
        <span className={`stat text-base w-8 text-right ${decided && isWinner ? 'font-bold text-ink' : 'text-ink-soft'}`}>
          {score}
        </span>
      )}
    </div>
  );
}

export default function GameRow({ game, showDate = true }) {
  const decided = game.played && game.winner != null;
  const homeWon = game.winner === 'home';
  const status = game.played
    ? `Final${game.innings ? ` / ${game.innings}` : ''}`
    : formatGameTime(game.gameTimeUTC) || 'Time TBD';

  return (
    <article className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="eyebrow text-ink-faint truncate">{roundLabel(game)}</span>
        <span className={`eyebrow whitespace-nowrap ${game.played ? 'text-ink-mute' : 'text-brick'}`}>{status}</span>
      </div>
      <Side team={game.away} score={game.awayScore} isWinner={decided && !homeWon} decided={decided} />
      <Side team={game.home} score={game.homeScore} isWinner={decided && homeWon} decided={decided} />
      {(showDate && game.gameTimeUTC != null) || game.streamUrl ? (
        <div className="flex items-center justify-between gap-2 mt-1 pl-3.5">
          {showDate && game.gameTimeUTC != null && (
            <span className="text-tiny text-ink-faint">{formatGameDate(game.gameTimeUTC)}</span>
          )}
          {game.streamUrl && (
            <a
              href={game.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="eyebrow text-brick hover:underline ml-auto"
            >
              Watch ↗
            </a>
          )}
        </div>
      ) : null}
    </article>
  );
}
