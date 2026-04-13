import type { PermitConnector, PermitSearchResult } from "./connector";

export class MockPermitConnector implements PermitConnector {
  name = "mock-connector";
  municipality = "Example County";

  async searchByAddress(address: string): Promise<PermitSearchResult> {
    return {
      municipality: this.municipality,
      permits: [
        {
          permitNumber: "MOCK-2024-001",
          permitType: "Roofing",
          permitDescription: `Mock permit for ${address}`,
          permitStatus: "ISSUED",
          contractorName: "Example Roofing Co",
          ownerName: "John Doe",
          issueDate: new Date("2024-01-15"),
          finalDate: null,
          rawData: { source: "mock", address },
        },
      ],
      searchedAt: new Date(),
    };
  }

  async searchByOwner(ownerName: string): Promise<PermitSearchResult> {
    return {
      municipality: this.municipality,
      permits: [
        {
          permitNumber: "MOCK-2024-002",
          permitType: "Windows",
          permitDescription: `Mock permit for owner ${ownerName}`,
          permitStatus: "APPLIED",
          contractorName: null,
          ownerName,
          issueDate: null,
          finalDate: null,
          rawData: { source: "mock", ownerName },
        },
      ],
      searchedAt: new Date(),
    };
  }
}
