import bcrypt from "bcrypt";
import { accountActionStore } from "../repositories/account-action.repository";
import { createActionToken, hashActionToken, type AccountActionStore, type ActionPurpose } from "./account-action";
import { accountMailer, createActionDispatcher, type AccountMailer, type ActionDispatcher } from "./account-mail.service";

export function makeAccountActionService(store: AccountActionStore, mailer: AccountMailer, dispatcher: ActionDispatcher, now = () => new Date()) {
  async function issue(userId: string, purpose: ActionPurpose) {
    const token = createActionToken();
    const user = await store.reserve(userId, purpose, hashActionToken(token), now());
    if (user) await mailer.send({ to: user.email, purpose, token });
  }
  return {
    requestVerification(userId: string) { return dispatcher.enqueue("VERIFY_EMAIL", () => issue(userId, "VERIFY_EMAIL")); },
    requestRecovery(email: string) {
      // Queue the whole lookup, not just delivery: nonexistent accounts return identically.
      return dispatcher.enqueue("RESET_PASSWORD", async () => {
        const user = await store.findByEmail(email);
        if (user) await issue(user.id, "RESET_PASSWORD");
      });
    },
    confirmVerification(token: string) { return store.consume(hashActionToken(token), "VERIFY_EMAIL", now()); },
    async resetPassword(token: string, password: string) {
      const passwordHash = await bcrypt.hash(password, 12);
      return store.consume(hashActionToken(token), "RESET_PASSWORD", now(), passwordHash);
    },
  };
}
export type AccountActionService = ReturnType<typeof makeAccountActionService>;
export const accountActionService = makeAccountActionService(accountActionStore, accountMailer, createActionDispatcher());
