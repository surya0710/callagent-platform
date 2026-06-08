export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface OverviewMetrics {
  totalCustomers: number;
  totalCampaigns: number;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  averageCallDuration: number;
  positiveSentiment: number;
  neutralSentiment: number;
  negativeSentiment: number;
}
