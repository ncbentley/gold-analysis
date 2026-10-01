"use client";

import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function TelegramAccountDialog({
  children,
  signedIn,
  connected,
  pending,
  hasError,
}: {
  children: React.ReactNode;
  signedIn: boolean;
  connected: boolean;
  pending: boolean;
  hasError: boolean;
}) {
  const label = connected ? "Connected" : signedIn ? "Not connected" : "Signed out";
  return (
    <Dialog defaultOpen={pending}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserRound data-icon="inline-start" />
        Account
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            connected && "bg-win/15 text-win",
            signedIn && !connected && "bg-amber-400/15 text-amber-300",
            !signedIn && "bg-white/10 text-muted-foreground",
            hasError && !connected && "bg-loss/15 text-loss",
          )}
        >
          {hasError && !connected ? "Error" : label}
        </span>
      </DialogTrigger>
      <DialogContent className="max-h-[min(40rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            {signedIn
              ? "The session is stored encrypted in the database. New posts arrive live, and a catch-up sync runs every two minutes."
              : "Use a dedicated Telegram account that has joined the signal channels. Messages are only read, never sent."}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
