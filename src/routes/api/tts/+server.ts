import OpenAI from 'openai';
import { OPENAI_API_KEY } from '$env/static/private';
export const config = { runtime: 'nodejs22.x' };

export const POST = async ({ request }) => {
	try {
		if (!OPENAI_API_KEY) {
			return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is missing on server' }), { status: 500 });
		}
		const { text, voice = 'alloy', format = 'mp3' } = await request.json();
		if (!text) return new Response(JSON.stringify({ error: 'text 필요' }), { status: 400 });
		const client = new OpenAI({ apiKey: OPENAI_API_KEY });
		const res = await client.audio.speech.create({
			model: 'gpt-4o-mini-tts',
			voice,
			format,
			input: text
		});
		const arrayBuf = await res.arrayBuffer();
		return new Response(Buffer.from(arrayBuf), {
			headers: { 'Content-Type': format === 'wav' ? 'audio/wav' : 'audio/mpeg' }
		});
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? 'TTS 실패' }), { status: 500 });
	}
};


