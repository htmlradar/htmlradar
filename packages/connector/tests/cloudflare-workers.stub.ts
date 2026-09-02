// `cloudflare:workers` is a runtime module that only exists inside workerd. The
// OAuth library imports WorkerEntrypoint from it purely to recognise the
// class-shaped handler style, which this Worker does not use.
export class WorkerEntrypoint {}
