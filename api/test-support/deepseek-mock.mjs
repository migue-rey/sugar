// Isolated verification server only. Production code has no fake-provider switch.
const originalFetch = globalThis.fetch
let calls = 0
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.deepseek.com/chat/completions') return originalFetch(url, options)
  calls++
  const request = JSON.parse(options.body)
  if (options.headers.Authorization === 'Bearer rejected-test-token') return new Response('{}', { status:401 })
  const context = request.messages.length > 1 ? JSON.parse(request.messages[1].content) : null
  const content = context ? `Resumen\nRevisión simulada del proyecto ${context.project.name}.\n\nObservaciones\n${context.project.nodes.map(n => n.block.name + ' (' + n.id + ')').join('\n')}\n\nRecomendaciones\nConfirmar tensiones de alimentación con los datasheets.\n\nDatos faltantes\nNo se especifica el consumo total.\n<script>alert('unsafe')</script>\nLlamada simulada ${calls}` : 'OK'
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:200,completion_tokens:100,total_tokens:300}}),{headers:{'content-type':'application/json'}})
}
