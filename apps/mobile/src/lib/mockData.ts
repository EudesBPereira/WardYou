// Temporary mock data for Phase 3 UI work. Replaced by API calls (TanStack
// Query against the Node backend) in Phase 4.

export type MemberStatus = "online" | "offline" | "alert";

export interface MockMember {
  id: string;
  name: string;
  // Achado de QA 2026-09-11: "member" e "dependent" faltavam aqui -- os dois
  // sao valores REAIS de FamilyRole (apps/mobile/src/services/api/types.ts),
  // nao so um detalhe de mock. `queries.ts` (mapDto) reusava este tipo pra
  // dado REAL vindo da API, e a ausencia forcava qualquer membro "member"
  // (ex.: um adulto trocado de "Criança" pra "Membro" via Alterar papel) a
  // cair no fallback ": child" -- rotulado errado como "Criança" na tela de
  // Família, mesmo com o papel certo gravado no banco. Ver Group() em
  // app/(tabs)/family.tsx para o balde correspondente.
  role: "admin" | "guardian" | "child" | "elder" | "member" | "dependent";
  status: MemberStatus;
  locationLabel: string;
  battery: number;
  lastSeen: string;
}

export const mockUser = { name: "Eudes Pereira", email: "eudes@wardyou.com" };

export const mockMembers: MockMember[] = [
  { id: "0", name: "Eudes", role: "admin", status: "online", locationLabel: "Office", battery: 64, lastSeen: "now" },
  { id: "1", name: "Ana Paula", role: "guardian", status: "online", locationLabel: "Home", battery: 82, lastSeen: "now" },
  { id: "2", name: "Lucas", role: "child", status: "online", locationLabel: "School", battery: 47, lastSeen: "2 min" },
  { id: "3", name: "Beatriz", role: "child", status: "alert", locationLabel: "Shopping Mall", battery: 11, lastSeen: "5 min" },
  { id: "4", name: "Rosa", role: "elder", status: "offline", locationLabel: "Home", battery: 90, lastSeen: "1 h" },
];

// Mock coordinates (around São Paulo) so the family map renders markers in
// mock mode, one per mockMembers entry.
export const mockMemberCoords: { latitude: number; longitude: number }[] = [
  { latitude: -23.5505, longitude: -46.6333 },
  { latitude: -23.5613, longitude: -46.6565 },
  { latitude: -23.5432, longitude: -46.6291 },
  { latitude: -23.5705, longitude: -46.6488 },
  { latitude: -23.5489, longitude: -46.6388 },
];

export type TripType = "individual" | "group" | "temporary";

export interface MockTrip {
  id: string;
  name: string;
  type: TripType;
  status: "active" | "closed";
  memberCount: number;
  endsLabel?: string;
  closedLabel?: string;
}

export const mockTrips: MockTrip[] = [
  { id: "t1", name: "Trip to grandma's", type: "group", status: "active", memberCount: 3, endsLabel: "18:30" },
  { id: "t2", name: "Walk home", type: "individual", status: "active", memberCount: 1, endsLabel: "17:45" },
  { id: "t3", name: "Beach weekend", type: "group", status: "closed", memberCount: 4, closedLabel: "26/06 17:44" },
];
