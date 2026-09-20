# API Coverage — Phase 8 external services

> Full coverage by default. Opt-outs are explicit, reasoned decisions for the export-delivery need defined by Phase 8.

| capability | decision | reason |
|---|---|---|
| `AWS S3: managed PutObject/multipart upload` | INTEGRATE | |
| `AWS S3: presigned GetObject` | INTEGRATE | |
| `AWS S3: DeleteObject on export expiry` | INTEGRATE | |
| `AWS S3: HeadObject verification` | OPT-OUT | Export completion is established by the awaited managed upload result and conditional database transition; Phase 8 does not accept browser-uploaded export objects. |
| `AWS S3: CopyObject` | OPT-OUT | Export jobs write directly to their deterministic private final key; there is no staged browser upload to promote. |
| `AWS S3: ListObjects/ListBuckets` | OPT-OUT | Database ExportJob records are authoritative; storage enumeration would create a second unsafe index. |
| `AWS S3: bucket create/configure/delete` | OPT-OUT | Infrastructure provisioning is deployment-owned and explicitly outside the application export request. |
| `AWS S3: public ACL/object access` | OPT-OUT | Private time-limited authorized downloads are mandatory; public access contradicts RPT-04/NFR-06. |
| `Netlify: Background Function execution` | INTEGRATE | |
| `Netlify: Scheduled Function export expiry` | INTEGRATE | |
| `Netlify: public request-supplied job instructions` | OPT-OUT | Database queue state is authoritative and public callers must not select datasets, filters, rows, or object keys. |
| `Netlify: synchronous long-running export response` | OPT-OUT | D-16 requires every export to use the asynchronous lifecycle. |
