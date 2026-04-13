export interface PermitSearchParams {
  address?: string;
  ownerName?: string;
  municipality: string;
}

export interface NormalizedPermit {
  permitNumber: string | null;
  permitType: string | null;
  permitDescription: string | null;
  permitStatus: string;
  contractorName: string | null;
  ownerName: string | null;
  issueDate: Date | null;
  finalDate: Date | null;
  rawData: Record<string, unknown>;
}

export interface PermitSearchResult {
  municipality: string;
  permits: NormalizedPermit[];
  searchedAt: Date;
}

export interface PermitConnector {
  name: string;
  municipality: string;
  searchByAddress(address: string): Promise<PermitSearchResult>;
  searchByOwner(ownerName: string): Promise<PermitSearchResult>;
}
