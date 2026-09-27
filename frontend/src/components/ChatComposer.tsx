import { IconSend2 } from '@tabler/icons-react'
import { useState, type KeyboardEvent } from 'react'
import { Button, inputClass } from './ui'

const MAX_LENGTH = 1000

interface ChatComposerProps {
  placeholder: string
  disabled: boolean
  onSend: (text: string) => void
}

export function ChatComposer({ placeholder, disabled, onSend }: ChatComposerProps) {
  const [text, setText] = useState('')
  const trimmed = text.trim()

  const submit = () => {
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex items-end gap-2 border-t border-slate-200 bg-white p-3"
    >
      <label className="sr-only" htmlFor="chat-input">
        Message
      </label>
      <textarea
        id="chat-input"
        rows={1}
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={`field-sizing-content max-h-40 min-h-10 flex-1 resize-none text-sm ${inputClass}`}
      />
      <Button type="submit" variant="send" icon={IconSend2} disabled={disabled || !trimmed} aria-label="Send message" />
    </form>
  )
}
