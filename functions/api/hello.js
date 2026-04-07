export async function onRequest(context) {
  return new Response(JSON.stringify({ message: 'Hello from Sheepshead API' }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
