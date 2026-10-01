import { renderHook } from "@testing-library/react";
import { useReputation } from "../useReputation";

jest.mock("@/app/queries/reputation.queries", () => ({
  useReputationByUser: jest.fn(() => ({
    data: {
      score: 12,
      rank: 4,
      totalVerifications: 8,
      successfulVerifications: 7,
      accuracy: 0.875,
    },
    isLoading: false,
    isError: false,
  })),
}));

describe("useReputation", () => {
  it("returns the query-backed reputation projection", () => {
    const { result } = renderHook(() => useReputation("user1"));
    expect(result.current.reputation?.score).toBe(12);
    expect(result.current.reputation?.rank).toBe(4);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });
});
