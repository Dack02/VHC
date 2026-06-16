import { useState } from 'react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  disabled?: boolean;
  /** Tailwind class(es) for the trigger wrapper. Defaults to `cursor-default`. */
  className?: string;
  /** When set, makes the trigger keyboard-focusable so the tooltip also opens on focus. */
  tabIndex?: number;
}

export function Tooltip({ children, content, disabled = false, className = 'cursor-default', tabIndex }: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const effectiveOpen = isOpen && !disabled;

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'top',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { delay: { open: 0, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  return (
    <>
      <span ref={refs.setReference} {...getReferenceProps()} tabIndex={tabIndex} className={className}>

        {children}
      </span>
      {effectiveOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="px-2 py-1 text-xs text-white bg-gray-800 rounded z-50 whitespace-pre-line max-w-xs"
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
