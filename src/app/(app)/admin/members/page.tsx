import { UsersRound } from "lucide-react";
import { grantComplimentaryAction, removeComplimentaryAction } from "@/app/actions/admin";
import { Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { requireAdmin } from "@/server/auth/guards";
import { TIER_LABEL } from "@/server/entitlements/config";
import { listMembers } from "@/server/members";

export const metadata = { title: "Members" };

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  await requireAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const members = await listMembers(q);
  const returnTo = q.trim() ? `/admin/members?q=${encodeURIComponent(q.trim())}` : "/admin/members";

  return (
    <>
      <PageHeader
        icon={UsersRound}
        size="sm"
        title="Members"
        description="Everyone who has joined. Grant complimentary Basic, Silver, or Gold when it is a higher tier than the plan they pay for. It does not charge them and stays until you remove it."
      />
      <Notice searchParams={sp} />
      <form action="/admin/members" method="get" className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Search by email" aria-label="Search by email" />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Pays for</TableHead>
              <TableHead>Complimentary</TableHead>
              <TableHead>Access</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {q.trim() ? "No members match that email." : "No one has joined yet."}
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="max-w-56 whitespace-normal font-medium [overflow-wrap:anywhere]">{member.email}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(member.createdAt)}</TableCell>
                  <TableCell>{member.emailVerifiedAt ? "Yes" : "No"}</TableCell>
                  <TableCell>{member.paid ? `${TIER_LABEL[member.paid.tier]} · ${member.paid.period}` : "None"}</TableCell>
                  <TableCell>{member.complimentary ? TIER_LABEL[member.complimentary] : "None"}</TableCell>
                  <TableCell>{member.accessLabel}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {member.canGrantBasic && (
                        <form action={grantComplimentaryAction}>
                          <input type="hidden" name="userId" value={member.id} />
                          <input type="hidden" name="tier" value="basic" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button type="submit" size="xs" variant="outline">
                            Grant Basic
                          </Button>
                        </form>
                      )}
                      {member.canGrantSilver && (
                        <form action={grantComplimentaryAction}>
                          <input type="hidden" name="userId" value={member.id} />
                          <input type="hidden" name="tier" value="silver" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button type="submit" size="xs" variant="outline">
                            Grant Silver
                          </Button>
                        </form>
                      )}
                      {member.canGrantGold && (
                        <form action={grantComplimentaryAction}>
                          <input type="hidden" name="userId" value={member.id} />
                          <input type="hidden" name="tier" value="gold" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button type="submit" size="xs">
                            Grant Gold
                          </Button>
                        </form>
                      )}
                      {member.canRemove && (
                        <form action={removeComplimentaryAction}>
                          <input type="hidden" name="userId" value={member.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <Button type="submit" size="xs" variant="destructive">
                            Remove
                          </Button>
                        </form>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
