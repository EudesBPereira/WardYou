// API DTOs mirrored from the existing backend contracts (WardYou.Contracts) and
// domain entities. These are the wire shapes the mobile client speaks.

// ---- Auth ----
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  fullName: string;
  email: string;
  phoneNumber?: string;
  password: string;
  confirmPassword: string;
}

export interface AuthResponse {
  userId: string;
  fullName: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  avatarUrl?: string | null;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RegisterDeviceRequest {
  deviceName: string;
  platform: string;
  pushToken?: string;
  publicKey?: string;
}

// ---- Domain enums (string-friendly) ----
export type FamilyRole = "admin" | "guardian" | "member" | "child" | "elder" | "dependent";
export type MemberStatus = "online" | "offline" | "alert";
export type TripType = "individual" | "group" | "temporary";
export type SosStatus = "active" | "acknowledged" | "closed";

// ---- Family ----
export type MembershipStatus = "pending" | "active";

export interface FamilyMemberDto {
  id: string;
  familyId: string;
  userId?: string | null;
  displayName: string;
  /** Raw nickname only — empty when the member has no custom nickname set
   *  (i.e. `displayName` is just their real name). Used to edit/prefill, since
   *  `displayName` alone can't tell "no nickname" apart from "nickname happens
   *  to equal the real name". */
  nickname?: string;
  avatarUrl?: string | null;
  role: FamilyRole;
  status: MemberStatus;
  membershipStatus: MembershipStatus;
  age?: number | null;
  relationshipLabel?: string | null;
  batteryLevel?: number | null;
  lastLocationLabel?: string | null;
  lastSeenAt?: string | null;
}

export interface FamilyDto {
  id: string;
  name: string;
  description?: string | null;
  inviteCode: string;
  members: FamilyMemberDto[];
}

export interface FamilySummaryDto {
  id: string;
  name: string;
  description?: string | null;
  inviteCode: string;
  memberCount: number;
  myRole: FamilyRole;
}

export interface FamilyInviteDto {
  id: string;
  familyId: string;
  email?: string | null;
  inviteCode: string;
  inviteLink: string;
  expiresAt: string;
  isActive: boolean;
  isUsed: boolean;
}

export interface CreateFamilyRequest {
  name: string;
  description?: string;
}

// ---- Trips (travel groups) ----
export interface TripDto {
  id: string;
  name: string;
  type: TripType;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  memberCount: number;
  closedAt?: string | null;
}

export interface CreateTripRequest {
  name: string;
  type?: TripType;
  /** ISO datetime. When omitted the server defaults the trip to 4h. */
  startsAt?: string;
  endsAt?: string;
  allowMembersToSeeEachOther?: boolean;
}

export interface UpdateTripRequest {
  name?: string;
  type?: TripType;
  endsAt?: string;
  allowMembersToSeeEachOther?: boolean;
}

/** An active member of a travel group (GET /travels/:id/members). */
export interface TripMemberDto {
  id: string;
  userId: string;
  fullName: string;
  isCreator: boolean;
  isMe: boolean;
  shareLiveLocation: boolean;
  shareBatteryStatus: boolean;
  receiveSosAlerts: boolean;
  joinedAt: string;
}

/** A trip member plus their latest travel position (GET /travels/:id/map). */
export interface TripMapMemberDto {
  userId: string;
  fullName: string;
  avatarUrl?: string | null;
  isMe: boolean;
  isCreator: boolean;
  isOnline: boolean;
  canViewLocation: boolean;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  batteryLevel?: number | null;
  capturedAt?: string | null;
}

export interface TripMapDto {
  travelGroupId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  allowMembersToSeeEachOther: boolean;
  createdByUserId: string;
  members: TripMapMemberDto[];
}

export interface TripInviteDto {
  inviteId: string;
  travelGroupId: string;
  inviteCode: string;
  expiresAt: string;
  inviteLink: string;
}

// ---- SOS ----
export interface SosEventDto {
  id: string;
  status: SosStatus;
  triggeredAt: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface TriggerSosRequest {
  familyId?: string;
  latitude?: number;
  longitude?: number;
  sendLocation: boolean;
}

// ---- Location ----
export interface LocationUpdateRequest {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  batteryLevel?: number;
  isCharging?: boolean;
}

/** A family member plus their last known position (GET /families/map). */
export interface FamilyMapMemberDto extends FamilyMemberDto {
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  locationCapturedAt?: string | null;
  canViewLocation: boolean;
}

export interface RecordLocationRequest {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  batteryLevel?: number;
  isCharging?: boolean;
  /** Reverse-geocoded place ("Rua X · Bairro") — fills "Último lugar". */
  locationLabel?: string;
}
