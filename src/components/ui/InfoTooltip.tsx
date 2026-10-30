import { useId, useState } from 'react'
import { copy } from '../../lib/copy'

export default function InfoTooltip({ topic, explanation }: { topic: string; explanation: string }) {
  const tooltipId = useId()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={copy.app.moreAbout.replace('{topic}', topic)}
        aria-describedby={isOpen ? tooltipId : undefined}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setIsOpen(false)
        }}
        className="ml-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:text-slate-100"
      >
        <span className="inline-flex size-6 items-center justify-center rounded-full border border-slate-500 text-xs dark:border-slate-400">i</span>
      </button>
      {isOpen && (
        <span id={tooltipId} role="tooltip" className="absolute left-0 top-8 z-40 w-56 rounded-lg bg-slate-950 p-3 text-sm font-normal text-white shadow-xl dark:bg-white dark:text-slate-950">
          {explanation}
        </span>
      )}
    </span>
  )
}
