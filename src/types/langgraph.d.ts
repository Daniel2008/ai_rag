declare module '@langchain/langgraph' {
  export const START: unique symbol
  export const END: unique symbol

  export class StateGraph<TState extends Record<string, unknown> = Record<string, unknown>> {
    constructor(args: { channels: Record<string, unknown> })
    addNode(name: string, node: (state: TState) => TState | Promise<TState>): this
    addEdge(from: unknown, to: unknown): this
    addConditionalEdges(
      source: string,
      routingFunction: (state: TState) => string | typeof END | Promise<string | typeof END>,
      pathMap?: Record<string, string | typeof END>
    ): this
    compile(): { invoke: (state: TState) => Promise<TState> }
  }

  export const Annotation: unknown
}
