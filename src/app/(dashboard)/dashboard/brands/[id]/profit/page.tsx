import { redirect } from "next/navigation";
import { auth, hasBrandAccess } from "@/lib/auth";
import { getBrand } from "@/lib/actions";
import { ProfitDashboard } from "@/components/profit-v1/profit-dashboard";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BrandProfitPage({ params }: PageProps) {
  const session = await auth();
  const { id } = await params;
  if (!session?.user?.id) redirect("/login");

  // Same membership rule as the API: non-members never see the page.
  const role = await hasBrandAccess(session.user.id, id);
  if (!role) redirect("/dashboard");

  const result = await getBrand(id);
  if (!result.brand) redirect("/dashboard");

  return <ProfitDashboard brandId={result.brand.id} brandName={result.brand.name} role={role} />;
}
