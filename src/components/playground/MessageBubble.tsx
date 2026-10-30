// Renders chat text as plain text without interpreting model output as HTML.
import type { ChatRole } from '../../core/adapters/types'
import { copy } from '../../lib/copy'

export default function MessageBubble({
  role,
  content,
  model,
}: {
  role: ChatRole
  content: string
  model?: string
}) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <article className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
        isUser
          ? 'bg-indigo-600 text-white'
          : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
      }`}>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {isUser ? copy.chat.you : model ?? copy.chat.ai}
        </p>
        <p className="whitespace-pre-wrap break-words text-base leading-6">
          {content || (!isUser ? copy.chat.thinking : '')}
        </p>
      </article>
    </div>
  )
}
