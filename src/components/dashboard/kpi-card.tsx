import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  trend?: { value: number; positive: boolean };
  /** Makes the whole tile a link — a number people want to act on should go somewhere. */
  href?: string;
}

export function KpiCard({ title, value, description, icon: Icon, trend, href }: KpiCardProps) {
  const card = (
    <Card className={cn(href && "h-full transition-shadow hover:shadow-md hover:ring-1 hover:ring-gray-300")}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {trend && (
          <p
            className={`text-xs ${trend.positive ? "text-green-600" : "text-red-600"}`}
          >
            {trend.positive ? "+" : ""}
            {trend.value}% from last period
          </p>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {card}
    </Link>
  ) : (
    card
  );
}
