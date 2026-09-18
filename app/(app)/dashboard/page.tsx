import type { Metadata } from "next";

import { EmployeeDashboard } from "@/components/dashboard/EmployeeDashboard";
import { StaffDashboard } from "@/components/dashboard/StaffDashboard";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard · IT Helpdesk" };

export default async function DashboardPage() {
  const profile = await requireProfile();

  if (profile.role === "employee") {
    return <EmployeeDashboard profile={profile} />;
  }

  return <StaffDashboard profile={profile} />;
}
