import type { z } from "zod";
import type {
  customerSummarySchema,
  customerProfileSchema,
  customerSaleSchema,
  batchSchema,
  inventoryCardSchema,
  batchEventSchema,
  cardExportSchema,
  categorySchema,
} from "@/shared/contracts/customers-cards";
export type CustomerSummary = z.infer<typeof customerSummarySchema>;
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
export type CustomerSale = z.infer<typeof customerSaleSchema>;
export type Batch = z.infer<typeof batchSchema>;
export type InventoryCard = z.infer<typeof inventoryCardSchema>;
export type BatchEvent = z.infer<typeof batchEventSchema>;
export type CardExport = z.infer<typeof cardExportSchema>;
export type Category = z.infer<typeof categorySchema>;
export const categories: Record<Category, string> = {
  car_owner: "Car owner",
  commercial_bus_driver: "Commercial bus",
  three_wheeler_user: "Three-wheeler",
  bike_user: "Bike",
  keg_buyer: "Keg buyer",
  cooking_gas_customer: "Cooking gas",
};
export const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
