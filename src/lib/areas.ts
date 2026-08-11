/**
 * Metro areas — where in town someone is actually willing to drive. A KC metro
 * "market" is 60 miles wide; downtown and Blue Springs are different golf
 * worlds. The draw only groups players whose listed areas overlap (empty list
 * = anywhere), and the profile picker writes users.areas directly.
 *
 * Keyed by market so new cities just add a block.
 */
export interface Area {
  id: string;
  label: string;
  hint: string;
}

export const AREAS_BY_MARKET: Record<string, Area[]> = {
  kc: [
    { id: 'downtown', label: 'Downtown / Midtown', hint: 'Swope, Minor Park, Hillcrest' },
    { id: 'northland', label: 'Northland', hint: 'Liberty, Gladstone, Shoal Creek, Staley Farms' },
    { id: 'east', label: 'East metro', hint: 'Independence, Blue Springs, Adams Pointe' },
    { id: 'south', label: 'South KC / Lee’s Summit', hint: 'Longview Lake, Fred Arbanas, Winterstone' },
    { id: 'joco', label: 'Johnson County', hint: 'Overland Park, Olathe, Lenexa, Heritage Park' },
    { id: 'kck', label: 'KCK / Wyandotte', hint: 'Dub’s Dread, Sunflower Hills, Painted Hills' },
  ],
};

export function areasFor(marketId: string): Area[] {
  return AREAS_BY_MARKET[marketId] ?? [];
}

export function areaLabel(marketId: string, id: string): string {
  return areasFor(marketId).find((a) => a.id === id)?.label ?? id;
}
