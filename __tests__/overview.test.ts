/**
 * The overview client's normalization.
 *
 * This exists because of one Go behaviour: `encoding/json` marshals a nil slice as `null`, not `[]`.
 * `recentDevices` and `activity` are both built with `make` in stats_handler.go today, so the app
 * never sees a null — but the home screen is the first thing after sign-in, and `activity.map(...)`
 * on a null is a white screen with no route back. These tests pin the guard rather than the current
 * server behaviour.
 */
import { getOverview } from '../src/api/stats';

const fetchMock = jest.fn();

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

describe('getOverview', () => {
  it('passes a well-formed payload through unchanged', async () => {
    const payload = {
      kpis: {
        totalEndpoints: 12,
        onlineNow: 9,
        offline: 3,
        availabilityPct: 75,
        activeSessions: 2,
      },
      recentDevices: [{ id: 'd1', name: 'BOX-01', status: 'online' }],
      activity: [
        { day: 'Mon', count: 0, value: 4 },
        { day: 'Tue', count: 8, value: 100 },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(getOverview()).resolves.toEqual(payload);
  });

  it('turns null slices into empty arrays', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        kpis: { totalEndpoints: 1, onlineNow: 1, offline: 0, availabilityPct: 100, activeSessions: 0 },
        recentDevices: null,
        activity: null,
      }),
    );

    const overview = await getOverview();

    expect(overview.recentDevices).toEqual([]);
    expect(overview.activity).toEqual([]);
    expect(overview.kpis.totalEndpoints).toBe(1);
  });

  it('fills missing KPIs with zeros rather than undefined', async () => {
    // A partial `kpis` would render "NaN%" in the availability meter — worse than an honest zero.
    fetchMock.mockResolvedValue(jsonResponse({ kpis: { onlineNow: 4 } }));

    const overview = await getOverview();

    expect(overview.kpis).toEqual({
      totalEndpoints: 0,
      onlineNow: 4,
      offline: 0,
      availabilityPct: 0,
      activeSessions: 0,
    });
  });

  it('survives an entirely empty body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(null));

    const overview = await getOverview();

    expect(overview.kpis.totalEndpoints).toBe(0);
    expect(overview.activity).toEqual([]);
    expect(overview.recentDevices).toEqual([]);
  });

  it('requests the single overview endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await getOverview();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/stats\/overview$/);
  });
});
