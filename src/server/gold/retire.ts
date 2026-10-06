import { phaseFromMembers, type PhaseMember } from "@/server/ideas/phase";

/** A Gold call comes off when every source it used expired or was cancelled before anyone filled. */
export function sourcesRetired(members: Array<PhaseMember | null | undefined>): boolean {
  return phaseFromMembers(members).cancelled;
}
