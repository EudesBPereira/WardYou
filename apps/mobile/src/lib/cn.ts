type ClassValue = string | false | null | undefined;

/** Tiny className joiner for NativeWind. Filters falsy values. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
