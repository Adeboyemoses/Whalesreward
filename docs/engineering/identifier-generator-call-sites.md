# Identifier generator call sites (WHR-217)

This exhaustive tracked-source sweep lists UUID generator calls and the canonical `newId` wrapper. Each cell records `line (number of calls on that line)`. Canonical `v7`, `uuidv7` and `newId` calls remain unchanged. See [identifier-sweep.md](identifier-sweep.md) for each v4 decision, the immutable migration policy and deployment handling. Test-only malicious examples in guard tests are assertions, not runtime identifier generators. The CI allowlist records the exact retained v4 source and occurrence counts.

| File | Line (calls) |
|---|---|
| `next.config.ts` | 11(1) |
| `prisma/migrations/20261109181000_correction_receipt_guards/migration.sql` | 34(1) |
| `prisma/migrations/20261116071000_giveaway_reconciliation/migration.sql` | 110(2) |
| `prisma/seed-auth.mjs` | 30(1), 49(1) |
| `scripts/diagnostics/card-storage-lock.ts` | 16(2) |
| `scripts/ops/meter.mjs` | 267(1), 341(1) |
| `scripts/ops/review-evidence.mjs` | 188(1), 189(1), 255(1), 256(1), 257(1) |
| `src/app/(attendant)/attendant/register/registration.tsx` | 187(1) |
| `src/app/(attendant)/attendant/sale/camera-composition.test.ts` | 37(1), 38(1), 106(1) |
| `src/app/(attendant)/attendant/sign-in/page.tsx` | 40(1) |
| `src/client/admin-api.ts` | 2(1) |
| `src/client/api.test.ts` | 11(1), 59(1), 66(1), 70(1), 160(1), 166(1), 206(1), 207(1), 230(1), 232(1), 245(1) |
| `src/client/api.ts` | 158(1), 221(1), 232(1), 245(1) |
| `src/client/offline/access.test.ts` | 26(1), 49(1), 87(1), 119(1), 160(1), 162(1), 163(1), 267(1), 283(1), 303(1), 376(1) |
| `src/client/offline/client.test.ts` | 23(1), 238(1), 320(1), 333(1), 368(1), 377(1), 408(1), 430(1), 501(1), 538(1), 692(1), 814(1) |
| `src/client/offline/client.ts` | 78(1), 281(1), 286(1), 388(1), 403(1), 545(1), 713(1), 1146(1), 1364(1) |
| `src/client/offline/corrections.test.ts` | 60(1), 90(1), 119(1), 120(1), 124(1), 132(1), 145(1), 154(1), 308(1), 530(1), 571(1), 596(1), 628(1), 725(1) |
| `src/client/offline/corrections.ts` | 80(1) |
| `src/client/offline/price-adoption.test.ts` | 26(1), 40(1), 42(1), 67(1), 76(1), 142(1), 204(1), 224(1), 330(1), 401(1), 416(1), 425(1), 433(1) |
| `src/client/offline/sync.test.ts` | 22(1), 223(1), 265(1), 401(1) |
| `src/client/offline/sync.ts` | 92(1), 299(1), 323(1), 342(1), 372(1) |
| `src/client/policy-status-messages.test.ts` | 18(1), 68(1), 92(2) |
| `src/client/price-refresh.test.ts` | 8(1), 22(1) |
| `src/client/registration-api.test.ts` | 6(1), 16(1), 24(1), 25(1), 29(1), 84(1), 105(1), 129(1), 133(1) |
| `src/client/registration-api.ts` | 126(1) |
| `src/client/sales-api.test.ts` | 6(1), 46(1), 52(1), 78(1), 80(1), 101(2), 110(2), 120(2) |
| `src/client/sales-api.ts` | 57(1), 198(1) |
| `src/client/sw/handover.js` | 26(1) |
| `src/client/sync-api.test.ts` | 7(1), 8(1), 16(1), 24(1), 58(1), 76(1), 99(1), 109(1) |
| `src/client/types.ts` | 5(1) |
| `src/server/auth.ts` | 103(1) |
| `src/server/lib/ids.test.ts` | 5(1) |
| `src/server/lib/ids.ts` | 4(1), 5(1) |
| `src/server/modules/admin-access/http.ts` | 96(1) |
| `src/server/modules/admin-access/mail.ts` | 80(1), 119(1), 227(1), 242(1), 359(2) |
| `src/server/modules/admin-access/repo.ts` | 194(1) |
| `src/server/modules/admin-access/service.ts` | 129(1), 181(1), 182(1), 190(1) |
| `src/server/modules/admin-access/sessions.ts` | 23(1) |
| `src/server/modules/audit/http.ts` | 52(1) |
| `src/server/modules/audit/write.ts` | 190(1) |
| `src/server/modules/auth/http.ts` | 92(1) |
| `src/server/modules/auth/service.ts` | 117(1), 156(1), 157(1) |
| `src/server/modules/cards/http.ts` | 93(1) |
| `src/server/modules/cards/service.ts` | 131(1), 158(1), 218(1) |
| `src/server/modules/corrections/http.ts` | 75(1) |
| `src/server/modules/corrections/service.ts` | 546(1), 547(1), 666(1), 904(1) |
| `src/server/modules/customers/recovery-http.ts` | 64(1) |
| `src/server/modules/customers/recovery.ts` | 279(1), 476(1), 621(1), 708(1), 709(1), 749(1), 940(1) |
| `src/server/modules/customers/service.ts` | 108(1), 137(1) |
| `src/server/modules/duplicates/service.ts` | 20(1), 78(1) |
| `src/server/modules/giveaway/http.ts` | 70(1) |
| `src/server/modules/giveaway/mutations.ts` | 91(1), 174(1), 186(1), 283(1), 450(1), 549(1), 569(1) |
| `src/server/modules/giveaway/phone-audit.ts` | 86(1) |
| `src/server/modules/giveaway/phone-http.ts` | 70(1) |
| `src/server/modules/giveaway/phones.ts` | 302(1), 373(1), 380(1), 464(1), 531(1), 669(1), 767(1) |
| `src/server/modules/giveaway/projection-http.ts` | 26(1) |
| `src/server/modules/reports/export-service.ts` | 81(1), 112(1) |
| `src/server/modules/reports/exports.ts` | 39(1) |
| `src/server/modules/reports/http.ts` | 59(1) |
| `src/server/modules/reviews/http.ts` | 61(1) |
| `src/server/modules/reviews/release-discovery-http.ts` | 21(1) |
| `src/server/modules/reviews/release-http.ts` | 54(1) |
| `src/server/modules/reviews/release-integrations.ts` | 119(1) |
| `src/server/modules/reviews/release-photo.ts` | 48(1), 49(1) |
| `src/server/modules/reviews/release-service.ts` | 658(1), 711(1), 816(1), 905(1) |
| `src/server/modules/reviews/release-upload-http.ts` | 57(1) |
| `src/server/modules/reviews/release-uploads.ts` | 174(1), 186(1) |
| `src/server/modules/reviews/service.ts` | 250(1), 315(1), 667(1), 774(1), 992(1) |
| `src/server/modules/sales/http.ts` | 64(1) |
| `src/server/modules/settings/http.ts` | 57(1) |
| `src/server/modules/settings/service.ts` | 555(1), 556(1), 557(1), 558(1), 840(1), 841(1), 842(1) |
| `src/server/modules/station/http.ts` | 80(1) |
| `src/server/modules/station/service.ts` | 101(1), 154(1), 223(1), 224(1), 225(1), 234(1), 458(1) |
| `src/server/modules/sync/http.ts` | 71(1) |
| `src/server/modules/sync/lookup-receipt.test.ts` | 14(1), 15(1), 16(1), 17(1), 19(1), 20(1) |
| `src/server/modules/sync/service.ts` | 245(1), 367(1), 368(2), 455(2), 473(1) |
| `src/server/modules/sync/settle.ts` | 141(1), 164(1), 195(1) |
| `src/shared/contracts/auth.ts` | 2(1) |
| `src/shared/contracts/customer-recovery.test.ts` | 13(1), 34(1), 41(1) |
| `src/shared/contracts/station.test.ts` | 14(1), 21(1), 25(1), 32(1), 50(1), 53(1), 60(1), 61(1), 71(1), 73(1), 83(1) |
| `tests/admin-access/admin-access.fixtures.ts` | 17(1), 18(1), 35(1) |
| `tests/admin-access/admin-access.spec.ts` | 67(1), 299(1), 457(1) |
| `tests/admin-navigation/mutations/helpers.ts` | 7(1) |
| `tests/admin-navigation/prepare-fixture-shape.ts` | 22(1), 23(1) |
| `tests/admin-navigation/timings.spec.ts` | 43(1) |
| `tests/audit/helpers.ts` | 9(1), 10(1), 56(1), 57(1), 85(1), 134(1) |
| `tests/campaign-proof-e2e/campaign-proof-real.spec.ts` | 124(1), 154(1), 172(1), 193(1), 221(1), 232(1), 353(1), 379(1), 415(1), 447(1), 467(1) |
| `tests/checklist/helpers.ts` | 34(1), 35(1), 43(1), 50(1), 65(1), 66(1), 67(1), 89(1), 98(1), 129(1), 158(1), 199(1), 235(1) |
| `tests/customer-changes/helpers.ts` | 26(1), 27(1), 28(1), 29(1), 65(1), 188(1), 208(1) |
| `tests/customers-cards/helpers.ts` | 20(1), 25(1), 38(1) |
| `tests/customers-cards/historical.ts` | 32(1), 33(1), 34(1), 44(1), 45(1), 46(1), 47(1), 80(1), 113(1), 131(1), 149(1), 162(1), 170(1) |
| `tests/customers-cards/policy.spec.ts` | 42(1), 103(1) |
| `tests/customers-cards/s02.spec.ts` | 38(1) |
| `tests/design-parity/customers-cards/capture.spec.ts` | 217(1), 284(1) |
| `tests/design-parity/m2-smoke-fixes/capture.spec.ts` | 157(1), 172(1) |
| `tests/design-parity/m2-smoke-fixes/export-unavailable.spec.ts` | 15(1) |
| `tests/design-parity/phone-smoke/capture.spec.ts` | 184(1) |
| `tests/design-parity/reviews/capture.spec.ts` | 90(1) |
| `tests/design-parity/sales-history/capture.spec.ts` | 67(1), 68(1), 85(1) |
| `tests/design-parity/station/station.spec.ts` | 110(1), 123(1), 135(1), 208(1) |
| `tests/design-parity/uploads/capture.spec.ts` | 144(1) |
| `tests/e2e/app-update.spec.ts` | 234(1) |
| `tests/e2e/attendant-auth.spec.ts` | 11(1), 12(1), 32(1), 36(1), 111(1), 115(1) |
| `tests/e2e/attendant-station-access.spec.ts` | 203(1), 214(1) |
| `tests/e2e/automatic-mail-lifecycle.spec.ts` | 22(1), 64(1) |
| `tests/e2e/campaign-timing-real.spec.ts` | 285(1), 383(1), 460(1) |
| `tests/e2e/customer-changes.spec.ts` | 237(1), 531(1), 564(1) |
| `tests/e2e/customer-registration.spec.ts` | 65(1) |
| `tests/e2e/customers-cards.spec.ts` | 44(1), 149(1), 246(1), 250(1), 270(1), 303(1), 388(1), 453(1), 547(1), 609(1), 662(1), 824(1), 937(1), 1105(1) |
| `tests/e2e/giveaway-recovered-phone-contract.spec.ts` | 22(1), 44(1) |
| `tests/e2e/giveaway-recovered-phone-http.spec.ts` | 65(1), 82(1), 116(1), 127(1), 155(1), 189(1) |
| `tests/e2e/leaderboards-protocol.spec.ts` | 25(1), 40(1), 48(1), 72(1), 83(1), 99(1) |
| `tests/e2e/leaderboards-real.spec.ts` | 154(1), 267(1), 278(1), 687(1) |
| `tests/e2e/m2-smoke-fixes.spec.ts` | 97(1), 161(1), 242(1), 268(1) |
| `tests/e2e/policy-status-messages.spec.ts` | 22(1), 191(1), 195(1), 277(1) |
| `tests/e2e/review-campaign-fixture.spec.ts` | 21(1), 45(1), 109(1) |
| `tests/e2e/review-screens-real.spec.ts` | 37(1), 126(1), 187(1) |
| `tests/e2e/sales-history-real.spec.ts` | 207(1), 530(1), 572(1), 592(1), 644(1), 645(1), 650(1), 819(1), 880(1) |
| `tests/e2e/station-management.spec.ts` | 47(1), 248(1), 501(1), 504(1), 551(1) |
| `tests/e2e/station-real-offboarding.spec.ts` | 70(1), 217(1) |
| `tests/fixtures/attendant-client-fake.ts` | 16(1), 26(1), 31(1), 32(1), 33(1), 35(1), 43(1), 113(1) |
| `tests/fixtures/attendant-http-fake.ts` | 63(1) |
| `tests/fixtures/held-release-browser.ts` | 56(1), 95(1), 100(1), 105(1), 121(1), 125(1), 126(1), 129(1), 130(1), 131(1), 163(1), 198(1), 222(1), 265(1), 266(1), 370(1), 386(1), 437(1), 448(1), 449(1), 566(1), 593(1), 605(1) |
| `tests/fixtures/sync-client-fake.ts` | 40(1), 49(1), 82(1), 118(1) |
| `tests/fixtures/sync-http-fake.ts` | 58(1), 80(1), 183(1), 253(1), 298(1), 331(1) |
| `tests/helpers/cards-adversarial-fixture.ts` | 49(1), 50(1), 51(1), 102(1), 148(1), 149(1), 150(1), 151(1), 160(1), 161(1), 162(1), 163(1), 197(1), 228(1), 246(1), 264(1), 277(1), 285(1) |
| `tests/helpers/corrections-adversarial-fixture.ts` | 100(1), 101(1), 102(1), 155(1), 165(1), 227(1), 228(1), 229(1) |
| `tests/helpers/customer-recovery-adversarial-fixture.ts` | 62(1), 75(1), 84(1) |
| `tests/helpers/giveaway-at-station-fixture.ts` | 19(1), 20(1), 48(1), 55(1), 74(1), 90(1), 104(1) |
| `tests/helpers/giveaway-fixture.ts` | 13(1), 14(1), 34(1), 41(1), 59(1), 75(1), 89(1), 110(1), 111(1), 139(1) |
| `tests/helpers/giveaway-release-fixture.ts` | 20(1), 27(1), 31(1), 51(1), 53(1), 78(1) |
| `tests/helpers/held-release-fixture.ts` | 18(1), 26(1), 36(1), 44(1), 49(1) |
| `tests/helpers/meter-fixture.ts` | 40(1), 59(1), 76(1), 86(1), 87(1), 88(1), 101(1), 231(1), 247(1), 248(1) |
| `tests/helpers/release-discovery-fixture.ts` | 12(1), 13(1), 21(1), 34(1), 58(1), 59(1), 60(1), 63(1), 79(1), 122(1) |
| `tests/helpers/reports-adversarial-fixture.ts` | 60(1), 70(2) |
| `tests/helpers/review-evidence-fixture.ts` | 74(1), 147(1), 164(1), 253(1), 312(1) |
| `tests/helpers/review-fixture.ts` | 43(1), 48(1), 57(1), 71(1), 85(1) |
| `tests/helpers/sync-fixture.ts` | 16(1), 17(1), 18(1), 19(1), 20(1), 21(1), 55(1), 101(1), 102(1), 135(1), 155(1), 163(1) |
| `tests/integration/admin-access-adversarial.test.ts` | 86(1), 113(1), 129(1), 130(1), 150(1), 184(1), 296(1), 310(1), 323(1), 329(1), 341(1), 387(1), 417(1), 439(1), 462(1), 482(1), 526(1), 527(1), 541(1), 571(1), 586(1), 612(1), 696(1), 779(1), 834(1), 852(1), 853(1), 914(1), 915(1), 952(1), 992(1), 1139(1), 1170(1), 1175(1), 1191(1), 1192(1), 1233(1), 1277(1), 1304(1), 1333(1) |
| `tests/integration/admin-mail-loop-adversarial.test.ts` | 56(1), 57(1), 73(1), 262(1), 269(1) |
| `tests/integration/attendant-auth.test.ts` | 31(1), 32(1), 33(1), 45(1), 55(1), 56(1), 77(1), 91(1), 117(1), 130(1), 135(1), 141(1), 148(1), 155(1), 176(1), 183(1), 193(1), 198(1), 207(1), 214(1), 228(1), 252(1), 266(1), 304(1), 316(1), 317(1), 350(1), 360(1), 361(1), 372(1), 375(1), 378(1), 394(1), 456(1) |
| `tests/integration/audit-adversarial.test.ts` | 77(1), 323(1), 493(1), 554(1), 559(1), 624(1), 660(1), 675(1), 710(1), 773(1), 799(1), 838(1) |
| `tests/integration/audit-domain-writers.test.ts` | 44(1), 49(1), 165(1), 188(1), 244(1) |
| `tests/integration/audit-history.test.ts` | 86(1), 134(1), 181(1), 230(1) |
| `tests/integration/audit-round1-regressions.test.ts` | 36(1), 170(1), 171(1), 196(1), 197(1), 198(1), 209(1), 222(1), 244(1), 260(1), 267(1) |
| `tests/integration/core-schema.test.ts` | 29(1), 30(1), 103(2), 124(1), 127(1), 128(1), 152(1), 173(2), 206(1), 215(2), 224(1), 229(1), 231(1), 261(2), 270(1), 277(2), 299(1), 302(1) |
| `tests/integration/corrections-adversarial.test.ts` | 32(1), 226(1), 280(1), 477(1), 547(1), 548(1), 549(1), 572(1), 576(1), 580(1), 626(1), 725(1), 801(1), 874(1) |
| `tests/integration/corrections.test.ts` | 43(1), 53(1), 63(1), 99(1), 124(1), 135(1), 152(1), 184(1), 196(1), 210(1), 285(1), 302(1), 374(1) |
| `tests/integration/customer-recovery-adversarial.test.ts` | 50(1), 55(1), 71(1), 93(1), 123(1), 221(1), 282(1), 370(1), 376(1), 489(1), 569(1), 667(1), 978(1), 1132(1), 1151(1) |
| `tests/integration/customer-recovery-http.test.ts` | 92(1), 110(1), 147(1), 155(1), 194(1), 211(1) |
| `tests/integration/customer-recovery-review-regressions.test.ts` | 51(1), 77(1), 102(1), 149(1), 186(1), 189(1), 240(1), 370(1), 398(1), 433(1), 441(1), 446(1), 493(1) |
| `tests/integration/customer-recovery.test.ts` | 31(1), 49(1), 69(1), 88(1), 108(1), 112(1), 126(1), 143(1), 172(3), 231(1) |
| `tests/integration/customers-cards-adversarial.test.ts` | 112(1), 125(1), 138(1), 156(1), 175(1), 308(1), 463(1), 499(1), 536(1), 539(1), 563(1), 601(1), 607(1), 678(1), 684(1), 693(1), 701(1), 718(1), 769(1), 792(1), 824(1), 925(1), 969(1), 1041(1), 1150(1), 1199(1), 1264(1) |
| `tests/integration/customers-cards.test.ts` | 54(1), 70(1), 91(1), 159(1), 161(1), 184(1), 213(1), 227(1), 238(1), 456(1), 550(1), 592(1), 643(1), 670(1), 737(1), 759(1), 804(1), 826(1), 836(1), 888(1), 916(1), 942(1), 971(1), 1003(1), 1094(1), 1163(1), 1240(1), 1372(1), 1437(1), 1501(1), 1592(1), 1648(1), 1711(1), 1772(1) |
| `tests/integration/database-waits.test.ts` | 75(1) |
| `tests/integration/duplicates.test.ts` | 261(1), 269(1), 304(1), 350(1), 378(1), 465(1) |
| `tests/integration/giveaway-exclusion-uniqueness.test.ts` | 24(1), 62(1), 82(1), 89(1), 93(1), 104(1), 253(1), 276(1), 291(1), 299(1), 341(1), 380(1), 405(1) |
| `tests/integration/giveaway-membership.test.ts` | 25(1), 26(1), 37(1), 93(1), 116(1), 117(1) |
| `tests/integration/giveaway-phones.test.ts` | 17(1), 45(1), 70(1), 96(1), 104(1), 115(1), 132(1), 146(1), 209(1), 232(1), 262(1), 276(1), 284(1), 302(1), 324(1), 355(1), 361(1), 370(1), 381(1), 417(1), 458(1), 469(1), 488(1), 517(1), 545(1), 573(1), 580(1), 584(1), 605(1), 639(1), 643(1), 671(1), 681(1), 682(1), 700(1), 708(1), 713(1), 721(1), 748(1), 774(1), 805(1), 831(1), 864(1), 900(1), 938(1) |
| `tests/integration/giveaway-photo-receipt.test.ts` | 28(1), 38(1), 147(1) |
| `tests/integration/giveaway-projections-adversarial.test.ts` | 72(1), 73(1), 76(1), 104(1), 112(1), 127(1), 142(1), 164(1), 211(1), 226(1), 273(1), 307(1), 368(1), 369(1), 380(1), 388(1), 456(1), 549(1), 570(1), 668(1), 671(1), 681(1), 684(1), 708(1), 725(1), 744(1), 806(1), 828(1), 838(1), 846(1), 1031(1), 1039(1), 1082(1), 1111(1), 1130(1), 1152(1), 1243(1), 1250(1), 1257(1), 1265(1), 1341(1), 1348(1), 1367(1), 1397(1), 1508(1), 1509(1), 1519(1), 1527(1), 1631(1), 1794(1) |
| `tests/integration/giveaway-projections.test.ts` | 108(1), 139(1), 208(1), 274(1), 281(1), 287(1), 349(1), 351(1) |
| `tests/integration/giveaway-provenance.test.ts` | 13(1), 14(1), 15(1), 17(1), 18(1), 28(1), 88(1), 146(1), 152(1) |
| `tests/integration/giveaway-ranking-edges.test.ts` | 22(1), 138(1), 153(1), 169(1), 184(1) |
| `tests/integration/giveaway-receipt-crash.test.ts` | 15(1), 25(1), 60(1), 85(1), 86(1) |
| `tests/integration/giveaway-recovered-phone.test.ts` | 23(1), 54(1), 68(1), 77(1), 84(1), 92(1), 99(1), 114(1), 164(1), 177(1), 270(1), 362(1), 398(1), 413(1), 446(1) |
| `tests/integration/giveaway-release-transitions.test.ts` | 34(1), 51(1), 138(1), 150(1), 184(1), 218(1) |
| `tests/integration/giveaway-review-regressions.test.ts` | 33(1), 39(1), 57(1), 64(1), 80(1), 96(1), 103(1), 149(1), 164(1) |
| `tests/integration/giveaway-snapshots.test.ts` | 26(1), 37(1), 80(1), 106(1), 149(1), 167(1), 200(1), 216(1), 267(1), 285(1), 315(1), 332(1), 373(1), 388(1), 410(1), 432(1), 442(1), 457(1), 507(1), 518(1), 580(1), 591(1), 631(1), 647(1), 648(1), 656(1), 673(1) |
| `tests/integration/giveaway-writers.test.ts` | 12(1), 13(1), 14(1), 34(1), 54(1), 133(1), 144(1), 169(1), 184(1), 212(1), 234(1), 252(1), 290(1), 305(1), 313(1), 338(1) |
| `tests/integration/giveaway.test.ts` | 93(1), 118(1), 142(1) |
| `tests/integration/health-policy.test.ts` | 30(1), 31(1), 32(1), 33(1), 267(1), 339(1), 357(1), 434(1), 438(1), 444(1), 464(1), 468(1), 481(1) |
| `tests/integration/held-release-consistency.test.ts` | 20(1), 33(1), 42(1), 61(1), 70(1), 75(1) |
| `tests/integration/held-release-followup.test.ts` | 29(1), 49(1), 51(1), 76(1), 162(1), 168(1), 171(1), 180(1), 214(1), 289(1), 294(1), 331(1), 448(1), 511(1), 562(1) |
| `tests/integration/held-release-hooks.test.ts` | 26(1), 46(1), 48(1), 73(1), 145(1), 148(1), 158(1), 287(1), 351(1), 380(1), 381(1), 382(1), 418(1), 475(1) |
| `tests/integration/held-release-policy.test.ts` | 31(1), 51(1), 53(1), 78(1), 164(1), 181(1), 225(1), 292(1) |
| `tests/integration/held-release-service.test.ts` | 30(1), 50(1), 52(1), 77(1), 137(1), 138(1), 139(1), 265(1), 266(1), 267(1), 273(1), 274(1), 280(1), 341(1), 342(1), 395(1), 410(1), 462(1), 511(1), 549(1), 565(1), 698(1), 723(1), 737(1), 849(1), 864(1), 1122(1), 1437(1), 1440(1), 1454(1), 1455(1), 1457(1), 1481(1), 1960(1), 1966(1), 1989(1), 2005(1), 2018(1), 2046(1), 2157(2) |
| `tests/integration/held-release.test.ts` | 20(1), 57(1), 74(1), 153(1) |
| `tests/integration/meter-adversarial.test.ts` | 78(1), 101(1), 106(1), 135(1), 136(1), 137(1), 305(1), 463(1), 485(1), 520(1), 521(1), 524(1), 535(1), 577(1), 602(1), 636(1), 640(1), 781(1), 800(1), 1136(1), 1145(1), 1149(1), 1153(1), 1186(1), 1187(1), 1188(1), 1189(1), 1190(1), 1191(1) |
| `tests/integration/meter-health.test.ts` | 146(1), 157(1) |
| `tests/integration/meter-operator.test.ts` | 25(1), 27(1), 79(1), 81(1), 105(1), 119(1), 120(1), 133(1), 333(1), 358(1), 359(1), 360(1), 387(1), 388(1), 465(1) |
| `tests/integration/meter.test.ts` | 383(1), 498(1), 502(1), 608(1), 611(1), 622(1), 625(1), 628(1), 685(1) |
| `tests/integration/offboarding-adversarial.test.ts` | 57(1), 100(1), 114(1), 115(1), 127(1), 137(1), 141(1), 154(1), 162(1), 179(1), 338(1), 378(1), 471(1), 488(1), 489(1), 490(1), 523(1), 547(1), 574(1), 600(1), 698(1), 780(1), 781(1), 809(1), 823(1) |
| `tests/integration/offboarding-management.test.ts` | 59(1), 61(1), 76(1), 127(1), 151(1), 163(1), 177(1), 178(1), 179(1), 187(1), 192(1), 234(1), 235(1), 236(1), 246(1), 278(1), 290(1), 295(1), 301(1), 302(1), 303(1), 320(1), 341(1), 356(1), 376(1), 389(1), 414(1), 452(1), 456(1), 514(1), 533(1), 555(1), 618(1), 634(1), 691(1), 700(1), 724(1), 731(1), 839(1), 840(1), 841(1), 849(1) |
| `tests/integration/p23-lookup-receipt.test.ts` | 97(1), 111(1), 123(1), 149(1), 158(1), 201(1), 268(1), 401(1), 429(1), 495(1), 535(1), 560(1), 590(1), 598(1), 674(1), 700(1), 921(1), 1068(1), 1092(1), 1110(1) |
| `tests/integration/p27-preservation.test.ts` | 33(1), 44(1), 64(1), 75(1), 278(1), 279(1), 373(1) |
| `tests/integration/p27-price-refresh.test.ts` | 37(1), 38(1), 39(1), 83(1), 168(1), 200(1), 283(1), 309(1), 319(1), 363(1), 386(1), 422(1), 460(1), 470(1), 488(1), 501(1), 547(1), 586(1), 587(1), 601(1) |
| `tests/integration/p28-campaign-settings.test.ts` | 82(1), 116(1), 164(1), 167(1), 310(1), 357(1), 566(1), 733(1), 738(1), 751(1), 752(1), 793(1), 794(1), 830(1), 1233(1), 1255(1), 1309(1), 1330(1) |
| `tests/integration/release-discovery.test.ts` | 60(1), 167(1), 185(1), 188(1), 213(1), 447(1), 471(1), 506(1), 581(1), 597(1), 602(1), 630(1), 636(1), 804(1), 817(1), 1093(1), 1106(1), 1121(1), 1171(1), 1213(1), 1229(1) |
| `tests/integration/release-uploads.test.ts` | 49(1), 56(1), 65(1), 95(1), 132(1), 173(1), 196(1), 200(1), 290(1), 334(1), 357(1), 366(1), 425(1), 436(1), 486(1), 508(1), 510(1), 527(2), 544(1), 545(1), 546(1), 553(1), 557(1), 565(1), 576(1), 619(1) |
| `tests/integration/reports-adversarial.test.ts` | 142(1), 307(1), 325(1), 341(1) |
| `tests/integration/reports-currency-adversarial.test.ts` | 167(1) |
| `tests/integration/reports-exports-adversarial.test.ts` | 37(1), 110(1), 182(1), 214(1), 356(1) |
| `tests/integration/reports-http-adversarial.test.ts` | 48(1), 125(1) |
| `tests/integration/reports-meter-adversarial.test.ts` | 72(1) |
| `tests/integration/review-evidence-adversarial.test.ts` | 74(1), 225(1), 235(1), 257(1) |
| `tests/integration/review-evidence-operator.test.ts` | 16(1), 18(1), 79(1), 260(1), 268(1) |
| `tests/integration/review-evidence-regressions.test.ts` | 71(1) |
| `tests/integration/review-evidence.test.ts` | 127(1), 227(1), 486(1), 602(1), 616(1), 652(1), 671(1), 699(1), 735(1), 803(1), 896(1), 914(1), 1026(1), 1053(1), 1164(1), 1167(1), 1192(1), 1195(1), 1217(1), 1226(1), 1230(1), 1234(1), 1483(1), 1572(1), 1611(1), 1705(1), 1739(1), 1740(1), 1741(1), 1882(1), 1914(1), 1944(1) |
| `tests/integration/reviews-adversarial.test.ts` | 102(1), 154(1), 158(1), 166(1), 169(2), 299(1), 342(1), 346(1), 350(1), 354(1), 478(1), 479(1), 547(1), 608(1), 620(1), 664(1) |
| `tests/integration/reviews.test.ts` | 150(1), 156(1), 167(1), 197(1), 250(1), 387(1), 457(1), 498(1), 500(1), 530(1), 531(1), 602(1) |
| `tests/integration/sale-original-date.test.ts` | 51(1), 110(1) |
| `tests/integration/sales-reads.test.ts` | 62(1), 93(1), 99(1), 152(1), 220(1), 231(1), 352(1), 404(2), 589(1) |
| `tests/integration/schema-contract.test.ts` | 189(2), 195(2), 206(1), 210(1), 232(1) |
| `tests/integration/settings-adversarial.test.ts` | 90(1), 215(1), 379(1), 394(1), 414(1), 432(1), 630(1), 706(1), 707(1), 791(1) |
| `tests/integration/settings-service.test.ts` | 43(1) |
| `tests/integration/settings-timing-lineage.test.ts` | 51(1), 137(1), 190(1), 213(1), 261(1), 278(1), 282(1), 313(1), 377(1) |
| `tests/integration/station-adversarial.test.ts` | 38(1), 81(1), 95(1), 96(1), 108(1), 118(1), 122(1), 135(1), 213(1), 253(1), 262(1), 305(1), 306(1), 371(1), 388(1), 400(1), 415(1), 431(1), 475(1), 497(1), 548(1), 570(1), 581(1) |
| `tests/integration/station-management.test.ts` | 53(1), 55(1), 70(1), 120(1), 138(1), 155(1), 178(1), 181(1), 214(1), 229(1), 238(1), 247(1), 258(1), 281(1), 293(1), 315(1), 333(1), 345(1), 349(1), 374(1), 397(1), 418(1), 424(1), 440(1), 451(1), 497(1), 506(1), 517(1), 537(1), 560(1), 573(1), 600(1), 635(1), 666(1), 667(1), 668(1), 669(1) |
| `tests/integration/station-price-visibility.test.ts` | 65(1), 66(1), 67(1), 98(1), 148(1), 220(1), 279(1), 283(1) |
| `tests/integration/sync-sales.test.ts` | 29(1), 67(1), 79(1), 97(1), 116(1), 128(1), 138(1), 146(1), 189(1), 247(1), 278(2), 294(1), 526(1), 607(1), 653(1), 656(1), 676(1), 681(1), 754(1), 759(1), 799(1), 800(2), 804(1), 821(1), 828(1), 954(1), 962(1), 996(1), 1053(1), 1055(1), 1115(1), 1144(1), 1152(1), 1191(1) |
| `tests/integration/zoho-diagnostics-adversarial.test.ts` | 66(1), 67(1), 83(1) |
| `tests/integration/zoho-mail-adversarial.test.ts` | 46(1), 47(1), 69(1), 79(1), 194(1), 317(1) |
| `tests/leaderboards/capture-fixture.ts` | 94(1) |
| `tests/leaderboards/helpers.ts` | 81(1), 82(1), 83(1), 105(1), 109(1), 132(1), 153(1), 154(1), 183(1), 195(1), 201(1), 220(1), 236(1), 267(1), 275(1) |
| `tests/price-adoption/helpers.ts` | 47(1), 61(2), 64(1), 70(1), 86(1), 91(1), 105(1), 112(1), 139(1), 174(1) |
| `tests/release-e2e/held-release-real.spec.ts` | 70(1), 84(1), 160(1), 190(1), 224(1), 250(1), 274(1), 278(1), 296(1), 306(1) |
| `tests/release-e2e/held-release-ui.spec.ts` | 388(1), 455(1), 456(1), 457(1), 462(1), 484(1), 903(1), 937(1), 1040(1), 1700(1), 1703(1), 1751(1), 1834(1) |
| `tests/release-e2e/original-date-real.spec.ts` | 45(1), 82(1) |
| `tests/reviews/helpers.ts` | 46(1), 47(1), 48(1), 81(1), 131(1), 132(1), 239(1), 260(1), 267(1), 284(1), 310(1) |
| `tests/sales-history/helpers.ts` | 60(1), 66(1), 85(1), 93(1), 158(1), 175(1), 217(1), 232(1), 269(1), 279(1), 322(1), 323(1), 324(1), 325(1), 346(1), 358(1), 359(1), 360(1) |
| `tests/settings/helpers.ts` | 132(1), 253(1) |
| `tests/station/assignment-end-fake.ts` | 30(1), 43(1), 154(1) |
| `tests/station/helpers.ts` | 12(1), 22(1), 82(1), 87(1) |
| `tests/storage/signed-upload.spec.ts` | 30(1), 58(2) |
