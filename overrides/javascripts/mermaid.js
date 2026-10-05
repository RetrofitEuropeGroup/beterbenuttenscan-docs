document$.subscribe(function () {
  mermaid.initialize({ startOnLoad: false })
  mermaid.run({ query: ".mermaid" })
})
