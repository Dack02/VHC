import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          autoComplete="off"
          className={`
            w-full px-4 py-3 min-h-[56px] text-lg
            border border-gray-300
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
            disabled:bg-gray-100 disabled:cursor-not-allowed
            ${error ? 'border-rag-red focus:ring-rag-red' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-rag-red">{error}</p>}
        {hint && !error && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          autoComplete="off"
          className={`
            w-full px-4 py-3 text-lg
            border border-gray-300
            focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
            disabled:bg-gray-100 disabled:cursor-not-allowed
            resize-none
            ${error ? 'border-rag-red focus:ring-rag-red' : ''}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-sm text-rag-red">{error}</p>}
      </div>
    )
  }
)

TextArea.displayName = 'TextArea'
