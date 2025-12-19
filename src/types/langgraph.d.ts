declare module '@langchain/langgraph' {
  export const START: unique symbol
  export const END: unique symbol

  export class StateGraph<TState extends Record<string, unknown> = Record<string, unknown>> {
    constructor(args: { channels: Record<string, unknown> })
    addNode(name: string, node: (state: TState) => TState | Promise<TState>): this
    addEdge(from: unknown, to: unknown): this
    compile(): { invoke: (state: TState) => Promise<TState> }
  }

  export const Annotation: unknown
}
