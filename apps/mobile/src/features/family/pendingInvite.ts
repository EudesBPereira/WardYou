import { storage } from "@/lib/storage";

// A family invite code captured from a deep link (https://app.wityu.com/join?
// familyInvite=CODE or wityu://join/CODE) before the user was authenticated.
// It's stashed here and consumed once a session exists — see
// useConsumePendingInvite. This lets a child tap an invite link, register, and
// land inside the family without re-entering the code.
const KEY = "wityu_pending_invite";

export const pendingInvite = {
  get: () => storage.getItem(KEY),
  set: (code: string) => storage.setItem(KEY, code),
  clear: () => storage.removeItem(KEY),
};
