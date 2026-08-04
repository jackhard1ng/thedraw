/**
 * Course entry via Google Places (spec §3).
 *
 * Courses are keyed by the Google `place_id`, never by a name string. This
 * component returns a { placeId, name, address, location } selection; the caller
 * upserts a `listed` course document (via a Cloud Function) keyed on placeId.
 *
 * The Places script is loaded lazily on first focus so the board list itself
 * carries no maps dependency.
 */
import { useEffect, useRef, useState } from 'react';

export interface CoursePick {
  placeId: string;
  name: string;
  address: string;
  location: { lat: number; lng: number } | null;
}

// Minimal shape of the pieces of the Google Maps JS API we touch.
interface GAutocompleteService {
  getPlacePredictions(
    req: { input: string; types?: string[] },
    cb: (
      predictions: { place_id: string; description: string }[] | null,
    ) => void,
  ): void;
}
interface GPlacesService {
  getDetails(
    req: { placeId: string; fields: string[] },
    cb: (place: GPlaceDetail | null) => void,
  ): void;
}
interface GPlaceDetail {
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat(): number; lng(): number } };
}

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          AutocompleteService: new () => GAutocompleteService;
          PlacesService: new (el: HTMLElement) => GPlacesService;
        };
      };
    };
    __theDrawPlacesLoading?: Promise<void>;
  }
}

function loadPlaces(): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve();
  if (window.__theDrawPlacesLoading) return window.__theDrawPlacesLoading;
  const key = import.meta.env.VITE_GOOGLE_PLACES_KEY;
  window.__theDrawPlacesLoading = new Promise<void>((resolve, reject) => {
    if (!key) {
      reject(new Error('VITE_GOOGLE_PLACES_KEY is not set'));
      return;
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Places'));
    document.head.appendChild(s);
  });
  return window.__theDrawPlacesLoading;
}

export function PlacesAutocomplete({
  onSelect,
  placeholder = 'Search for a course…',
}: {
  onSelect: (pick: CoursePick) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [preds, setPreds] = useState<{ place_id: string; description: string }[]>(
    [],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svc = useRef<GAutocompleteService | null>(null);
  const details = useRef<GPlacesService | null>(null);

  async function ensureLoaded() {
    if (ready) return;
    try {
      await loadPlaces();
      svc.current = new window.google!.maps!.places!.AutocompleteService();
      details.current = new window.google!.maps!.places!.PlacesService(
        document.createElement('div'),
      );
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!ready || !svc.current || query.trim().length < 3) {
      setPreds([]);
      return;
    }
    const handle = setTimeout(() => {
      svc.current!.getPlacePredictions(
        { input: query, types: ['establishment'] },
        (p) => setPreds(p ?? []),
      );
    }, 200);
    return () => clearTimeout(handle);
  }, [query, ready]);

  function choose(pred: { place_id: string; description: string }) {
    setQuery(pred.description);
    setPreds([]);
    details.current?.getDetails(
      {
        placeId: pred.place_id,
        fields: ['name', 'formatted_address', 'geometry'],
      },
      (place) => {
        const loc = place?.geometry?.location;
        onSelect({
          placeId: pred.place_id,
          name: place?.name ?? pred.description,
          address: place?.formatted_address ?? '',
          location: loc ? { lat: loc.lat(), lng: loc.lng() } : null,
        });
      },
    );
  }

  return (
    <div className="relative">
      <input
        className="field-input"
        placeholder={placeholder}
        value={query}
        onFocus={ensureLoaded}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && (
        <p className="mt-1 text-xs text-tournament">
          Course search unavailable ({error}). You can still post a flexible-course round.
        </p>
      )}
      {preds.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-sm border border-rule-strong bg-paper-raised shadow-lg">
          {preds.map((p) => (
            <li key={p.place_id}>
              <button
                type="button"
                onClick={() => choose(p)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-paper-sunken"
              >
                {p.description}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
