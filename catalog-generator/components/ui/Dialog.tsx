"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import { useRef, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./ui.module.css";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
  busy?: boolean;
};

// Controlled dialogs may be opened by several row buttons rather than a single Trigger.
function useReturnFocus() {
  const origin = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (origin.current?.isConnected && !origin.current.matches(":disabled")) origin.current.focus();
      else {
        const main = document.querySelector("main");
        if (main) {
          const previous = main.getAttribute("tabindex");
          main.setAttribute("tabindex", "-1");
          main.focus();
          if (previous === null) main.removeAttribute("tabindex");
          else main.setAttribute("tabindex", previous);
        }
      }
    },
  };
}

export function Dialog({ open, onOpenChange, title, description, children, busy = false }: DialogProps) {
  const focus = useReturnFocus();
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixDialog.Portal><RadixDialog.Overlay className={styles.overlay} />
      <RadixDialog.Content {...focus} className={styles.dialog} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => event.preventDefault()}>
        <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
        <RadixDialog.Description className={styles.description}>{description}</RadixDialog.Description>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

export function AlertDialog({ open, onOpenChange, title, description, children, busy = false }: DialogProps) {
  const focus = useReturnFocus();
  return <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixAlertDialog.Portal><RadixAlertDialog.Overlay className={styles.overlay} />
      <RadixAlertDialog.Content {...focus} className={styles.dialog} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
        <RadixAlertDialog.Title className={styles.title}>{title}</RadixAlertDialog.Title>
        <RadixAlertDialog.Description className={styles.description}>{description}</RadixAlertDialog.Description>
        {children}
      </RadixAlertDialog.Content>
    </RadixAlertDialog.Portal>
  </RadixAlertDialog.Root>;
}

export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export function AlertDialogCancel({ disabled = false, onClick }: { disabled?: boolean; onClick?: () => void }) {
  return <RadixAlertDialog.Cancel asChild><Button variant="secondary" disabled={disabled} onClick={onClick}>Cancelar</Button></RadixAlertDialog.Cancel>;
}

export function DestructiveConfirm({ open, onOpenChange, title, description, onConfirm }: Omit<DialogProps, "children" | "busy"> & { onConfirm: () => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
    <DialogActions><AlertDialogCancel /><Button variant="destructive" onClick={() => { onOpenChange(false); onConfirm(); }}>Eliminar</Button></DialogActions>
  </AlertDialog>;
}

export { styles as dialogStyles };
