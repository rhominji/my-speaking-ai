import { json } from '@sveltejs/kit';
import OpenAI from 'openai';
import { OPENAI_API_KEY } from '$env/static/private';
export const config = { runtime: 'nodejs22.x' };

export const POST = async ({ request }) => {
	try {
		if (!OPENAI_API_KEY) {
			return json({ error: 'OPENAI_API_KEY is missing on server' }, { status: 500 });
		}
		const form = await request.formData();
		const file = form.get('audio') as File | null;
		if (!file) {
			return json({ error: 'audio 파일이 필요합니다.' }, { status: 400 });
		}
		const client = new OpenAI({ apiKey: OPENAI_API_KEY });
		const tr = await client.audio.transcriptions.create({
			file,
			model: 'gpt-4o-transcribe'
		});
		return json({ text: (tr as any).text ?? '' });
	} catch (err: any) {
		return json({ error: err?.message ?? 'STT 실패' }, { status: 500 });
	}
};


