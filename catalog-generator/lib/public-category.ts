export function validPublicCategory(categories: { id: string }[], value: unknown): string {
  return typeof value === "string" && value.length <= 200 && categories.some(category => category.id === value) ? value : "";
}
export function publicCategoryHref(publicId: string, categoryId: string) {
  return `/c/${encodeURIComponent(publicId)}${categoryId ? `?category=${encodeURIComponent(categoryId)}` : ""}#productos`;
}
