import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { Copy, CheckCircle2, AlertTriangle, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function toastText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(toastText).filter(Boolean).join(" ");
  }

  return "";
}

function buildCopyText(title: ReactNode, description: ReactNode): string {
  return [toastText(title), toastText(description)].filter(Boolean).join("\n");
}

async function copyVisibleToastText(text: string) {
  if (!text || !navigator.clipboard) {
    return;
  }

  await navigator.clipboard.writeText(text);
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant = "default", ...props }) {
        const copyText = buildCopyText(title, description);

        let Icon = Info;
        let iconColor = "text-primary";

        if (variant === "destructive") {
          Icon = XCircle;
          iconColor = "text-destructive";
        } else if (variant === "success") {
          Icon = CheckCircle2;
          iconColor = "text-success";
        } else if (variant === "warning") {
          Icon = AlertTriangle;
          iconColor = "text-warning";
        }

        return (
          <Toast key={id} variant={variant} {...props}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", iconColor)} aria-hidden="true" />
            <div className="flex-1 space-y-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            {copyText && (
              <button
                type="button"
                className="absolute right-9 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400"
                aria-label="Fehlermeldung kopieren"
                title="Fehlermeldung kopieren"
                onClick={() => {
                  void copyVisibleToastText(copyText);
                }}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
