import type { RoleName } from "@/generated/prisma";

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: RoleName;
};

export type LeadFilters = {
  search?: string;
  stageId?: string;
  sourceId?: string;
  assignedUserId?: string;
  serviceCategoryId?: string;
  city?: string;
  county?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
