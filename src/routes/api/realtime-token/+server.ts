import { OPENAI_API_KEY } from '$env/static/private';

// Issues a client secret (ephemeral) for Realtime/WebRTC or WebSocket
export const POST = async () => {
	try {
		const apiKey = OPENAI_API_KEY;
		if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
			return new Response(
				JSON.stringify({ error: 'OPENAI_API_KEY is missing on server', hint: 'Check .env(.local) and restart dev server' }),
				{ status: 500, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const body = JSON.stringify({
			session: {
				type: 'realtime',
				model: 'gpt-realtime',
				audio: { output: { voice: 'marin' } }
			}
		});
		const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body
		});
		const text = await resp.text();
		if (!resp.ok) {
			// Bubble up full response for client-side debug panel
			return new Response(text, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
		}
		return new Response(text, { headers: { 'Content-Type': 'application/json' } });
	} catch (e: any) {
		return new Response(JSON.stringify({ error: e?.message ?? '토큰 발급 실패' }), { status: 500 });
	}
};


