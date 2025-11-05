<script>
	let mediaRecorder;
	let mediaStream;
	let audioChunks = [];
	let isRecording = false;
	let isPaused = false;
	let recordedUrl = '';
	let recordedBlob;
	let errorMessage = '';
	let elapsedMs = 0;
	let timerId;
	let audioEl;

	let analyser;
	let audioContext;
	let sourceNode;
	let volume = 0; // 0..100
	let rafId;

	// === Realtime(WebRTC) 초저지연 ===
	let isRealtime = false;
	let pc; // RTCPeerConnection
	let remoteAudioEl; // 원격 음성 출력

	// 디버그
	let debugOpen = false;
	let debugLogs = [];
	let realtimeError = '';

	// 연결/통계 상태
	let rtState = { ice: 'new', connection: 'new', signaling: 'stable' };
	let statsTimerId;
	let bytesSentTotal = 0;
	let bytesRecvTotal = 0;
	let prevBytesSent = 0;
	let prevBytesRecv = 0;
	let kbpsUp = 0;
	let kbpsDown = 0;
	let realtimeClosedAt = '';

	function logDebug(step, payload) {
		try {
			debugLogs = [
				{ time: new Date().toISOString(), step, message: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) },
				...debugLogs
			].slice(0, 100);
		} catch {
			// noop
		}
	}

	async function debugFetch(url, init) {
		logDebug('fetch:request', { url, ...{ method: init?.method || 'GET' }, headers: init?.headers, body: init?.body instanceof FormData ? 'FormData' : init?.body });
		const res = await fetch(url, init);
		const headers = Array.from(res.headers.entries());
		const text = await res.text();
		logDebug('fetch:response', { url, status: res.status, ok: res.ok, headers, text: text.slice(0, 2000) });
		return { ok: res.ok, status: res.status, headers, text };
	}

	async function startRealtime() {
		if (isRealtime) return;
		await ensureMic();
		realtimeError = '';
		// 1) PeerConnection 생성 (초저지연에 유리한 기본 설정)
		pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		});
		pc.onicecandidate = () => {};
		pc.ontrack = (e) => {
			// 모델 음성 출력
			if (!remoteAudioEl) return;
			remoteAudioEl.srcObject = e.streams[0];
			remoteAudioEl.play().catch(() => {});
		};
		pc.oniceconnectionstatechange = () => { rtState.ice = pc.iceConnectionState; };
		pc.onconnectionstatechange = () => { rtState.connection = pc.connectionState; };
		pc.onsignalingstatechange = () => { rtState.signaling = pc.signalingState; };
		// 2) 로컬 마이크 트랙 추가
		mediaStream.getTracks().forEach((t) => pc.addTrack(t, mediaStream));
		// 3) 수신 전용 트랜시버로 지연 최소화
		pc.addTransceiver('audio', { direction: 'recvonly' });
		// 4) SDP offer 생성
		const offer = await pc.createOffer({ offerToReceiveAudio: true });
		await pc.setLocalDescription(offer);
		// 5) 서버에서 ephemeral 토큰 발급
		const tokenResp = await debugFetch('/api/realtime-token', { method: 'POST' });
		let tokenData = {};
		try { tokenData = JSON.parse(tokenResp.text || '{}'); } catch (e) { logDebug('token:parse:error', String(e)); }
		const ephemeralKey = tokenData.value || tokenData.client_secret || tokenData.token || '';
		if (!tokenResp.ok || !ephemeralKey) {
			realtimeError = `토큰 발급 실패(status ${tokenResp.status})`;
			throw new Error('ephemeral 토큰 발급 실패');
		}
		// 6) OpenAI Realtime에 SDP 전송 후 answer 수신
		const sdpResp = await debugFetch('https://api.openai.com/v1/realtime/calls', {
			method: 'POST',
			body: offer.sdp,
			headers: {
				Authorization: `Bearer ${ephemeralKey}`,
				'Content-Type': 'application/sdp'
			}
		});
		const answerSdp = sdpResp.text;
		await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
		isRealtime = true;
		bytesSentTotal = 0; bytesRecvTotal = 0; prevBytesSent = 0; prevBytesRecv = 0; kbpsUp = 0; kbpsDown = 0; realtimeClosedAt = '';
		startStatsPolling();
	}

	async function stopRealtime() {
		if (!pc) return;
		try { pc.getSenders().forEach((s) => { try { s.track && s.track.stop(); } catch {} }); } catch {}
		try { pc.close(); } catch {}
		pc = undefined;
		isRealtime = false;
		rtState.connection = 'closed';
		stopStatsPolling();
		realtimeClosedAt = new Date().toISOString();
		if (remoteAudioEl) { try { remoteAudioEl.srcObject = null; } catch {} }
	}

	function startStatsPolling() {
		stopStatsPolling();
		statsTimerId = setInterval(async () => {
			if (!pc) return;
			try {
				const report = await pc.getStats();
				let sent = 0, recv = 0;
				report.forEach((s) => {
					if (s.type === 'outbound-rtp' && s.kind === 'audio') sent += s.bytesSent || 0;
					if (s.type === 'inbound-rtp' && s.kind === 'audio') recv += s.bytesReceived || 0;
				});
				bytesSentTotal = sent; bytesRecvTotal = recv;
				kbpsUp = Math.max(0, Math.round(((sent - prevBytesSent) * 8) / 1000));
				kbpsDown = Math.max(0, Math.round(((recv - prevBytesRecv) * 8) / 1000));
				prevBytesSent = sent; prevBytesRecv = recv;
			} catch (e) { /* ignore */ }
		}, 1000);
	}

	function stopStatsPolling() {
		if (statsTimerId) clearInterval(statsTimerId);
		statsTimerId = undefined;
		kbpsUp = 0; kbpsDown = 0;
	}

	// waveform canvas
	let canvasEl;
	let ctx;
	let dpr = 1;
	let canvasWidth = 480;
	let canvasHeight = 160;

	async function ensureMic() {
		try {
			if (mediaStream) return mediaStream;
			mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			setupAnalyser(mediaStream);
			return mediaStream;
		} catch (err) {
			errorMessage = '마이크 권한을 허용해주세요.';
			throw err;
		}
	}

	function setupAnalyser(stream) {
		cleanupAnalyser();
		try {
			audioContext = new (window.AudioContext || window.webkitAudioContext)();
			sourceNode = audioContext.createMediaStreamSource(stream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 2048;
			sourceNode.connect(analyser);
			loopLevel();
		} catch {
			// 분석기는 선택 사항이므로 에러 무시
		}
	}

	function loopLevel() {
		if (!analyser) return;
		const bufferLength = analyser.fftSize;
		const timeArray = new Uint8Array(bufferLength);
		const freqArray = new Uint8Array(analyser.frequencyBinCount);
		const tick = () => {
			// level (RMS) 계산
			analyser.getByteTimeDomainData(timeArray);
			let sum = 0;
			for (let i = 0; i < bufferLength; i++) {
				const v = (timeArray[i] - 128) / 128; // -1..1
				sum += v * v;
			}
			const rms = Math.sqrt(sum / bufferLength);
			volume = Math.min(100, Math.max(0, Math.round(rms * 140)));

			// 파형 막대 렌더링
			if (ctx && canvasEl) {
				analyser.getByteFrequencyData(freqArray);
				ctx.clearRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);
				ctx.fillStyle = '#0b1020';
				ctx.fillRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);
				const bars = 48; // 막대 개수
				const gap = 4 * dpr;
				const barWidth = ((canvasWidth * dpr) - gap * (bars - 1)) / bars;
				for (let i = 0; i < bars; i++) {
					const idx = Math.floor((i / bars) * freqArray.length);
					const value = freqArray[idx] / 255; // 0..1
					const h = Math.max(4 * dpr, value * canvasHeight * dpr);
					const x = i * (barWidth + gap);
					const y = (canvasHeight * dpr) - h;
					ctx.fillStyle = '#3b82f6';
					ctx.fillRect(x, y, barWidth, h);
				}
			}
			rafId = requestAnimationFrame(tick);
		};
		tick();
	}

	function cleanupAnalyser() {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = undefined;
		try { sourceNode && sourceNode.disconnect(); } catch {}
		try { analyser && analyser.disconnect(); } catch {}
		try { audioContext && audioContext.close(); } catch {}
		sourceNode = undefined;
		analyser = undefined;
		audioContext = undefined;
	}

	function clearTimer() {
		if (timerId) clearInterval(timerId);
		timerId = undefined;
	}

	function startTimer() {
		clearTimer();
		const startAt = Date.now() - elapsedMs;
		timerId = setInterval(() => {
			elapsedMs = Date.now() - startAt;
		}, 100);
	}

	async function startRecording() {
		if (isRecording) return;
		errorMessage = '';
		await ensureMic();
		audioChunks = [];
		recordedUrl && URL.revokeObjectURL(recordedUrl);
		recordedUrl = '';
		recordedBlob = undefined;
		mediaRecorder = new MediaRecorder(mediaStream);
		mediaRecorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) audioChunks.push(e.data);
		};
		mediaRecorder.onstop = () => {
			if (audioChunks.length) {
				recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
				recordedUrl = URL.createObjectURL(recordedBlob);
			}
		};
		mediaRecorder.start();
		isRecording = true;
		isPaused = false;
		elapsedMs = 0;
		startTimer();
	}

	function pauseOrResume() {
		if (!isRecording || !mediaRecorder) return;
		if (!isPaused) {
			mediaRecorder.pause();
			isPaused = true;
			clearTimer();
		} else {
			mediaRecorder.resume();
			isPaused = false;
			startTimer();
		}
	}

	function stopRecording() {
		if (!isRecording || !mediaRecorder) return;
		mediaRecorder.stop();
		isRecording = false;
		isPaused = false;
		clearTimer();
	}

	function resetRecording() {
		stopRecording();
		audioChunks = [];
		recordedBlob = undefined;
		if (recordedUrl) URL.revokeObjectURL(recordedUrl);
		recordedUrl = '';
		elapsedMs = 0;
		errorMessage = '';
	}

	function downloadRecording() {
		if (!recordedBlob) return;
		const a = document.createElement('a');
		const url = recordedUrl || URL.createObjectURL(recordedBlob);
		a.href = url;
		a.download = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
		a.click();
	}

	// === STT/LLM/TTS 체인 연동 ===
	let transcribedText = '';
	let assistantReply = '';
	let replyAudioUrl = '';

	async function sendToStt() {
		if (!recordedBlob) return;
		const fd = new FormData();
		fd.append('audio', recordedBlob, 'recording.webm');
		const r = await fetch('/api/stt', { method: 'POST', body: fd });
		const data = await r.json();
		transcribedText = data.text || '';
	}

	async function askLlm() {
		if (!transcribedText) return;
		const r = await fetch('https://api.openai.com/v1/chat/completions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${import.meta.env.VITE_OPENAI_PROXY_KEY ?? ''}`
			},
			body: JSON.stringify({
				model: 'gpt-4o-mini',
				messages: [
					{ role: 'system', content: 'You are an English conversation partner. Keep answers concise.' },
					{ role: 'user', content: transcribedText }
				]
			})
		});
		if (!r.ok) { assistantReply = ''; return; }
		const data = await r.json();
		assistantReply = data.choices?.[0]?.message?.content ?? '';
	}

	async function ttsReply() {
		if (!assistantReply) return;
		const r = await fetch('/api/tts', { method: 'POST', body: JSON.stringify({ text: assistantReply }) });
		const buf = await r.arrayBuffer();
		if (replyAudioUrl) URL.revokeObjectURL(replyAudioUrl);
		replyAudioUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
	}

	function fmt(ms) {
		const sec = Math.floor(ms / 1000);
		const m = String(Math.floor(sec / 60)).padStart(2, '0');
		const s = String(sec % 60).padStart(2, '0');
		return `${m}:${s}`;
	}

	function onDestroy() {
		clearTimer();
		cleanupAnalyser();
		try { mediaRecorder && mediaRecorder.stop(); } catch {}
		try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
		if (recordedUrl) URL.revokeObjectURL(recordedUrl);
	}

	function ensureCanvas() {
		if (!canvasEl) return;
		dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
		ctx = canvasEl.getContext('2d');
		canvasWidth = Math.min(520, Math.max(320, Math.floor(window.innerWidth - 64)));
		canvasHeight = 160;
		canvasEl.width = canvasWidth * dpr;
		canvasEl.height = canvasHeight * dpr;
		canvasEl.style.width = canvasWidth + 'px';
		canvasEl.style.height = canvasHeight + 'px';
	}
</script>

<main class="container">
	<header class="header">
		<h1>🎙️ 음성 녹음기</h1>
		<p class="subtitle">목소리를 녹음하고 확인해보세요</p>
	</header>

	<section class="recorder-card">
		<div class="mic-badge" aria-hidden="true">
			<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" fill="#334155"/>
				<path d="M5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8v3h2v-3a9 9 0 0 0 8-8 1 1 0 1 0-2 0 7 7 0 0 1-14 0Z" fill="#334155"/>
			</svg>
		</div>
		<div class="wave-wrap">
			<canvas bind:this={canvasEl} width={canvasWidth * dpr} height={canvasHeight * dpr}></canvas>
		</div>
		<div class="rt-controls">
			{#if !isRealtime}
				<button class="primary" on:click={startRealtime}>실시간 연결 시작</button>
			{:else}
				<button on:click={stopRealtime}>실시간 종료</button>
			{/if}
			<audio bind:this={remoteAudioEl} autoplay></audio>
		</div>
		<div class="rt-status">
			<div>연결: {rtState.connection} • ICE: {rtState.ice} • 신호: {rtState.signaling}</div>
			<div>업/다운 대역폭: {kbpsUp} / {kbpsDown} kbps</div>
			<div>누적 바이트: ↑ {bytesSentTotal}B, ↓ {bytesRecvTotal}B {#if realtimeClosedAt}(종료: {realtimeClosedAt}){/if}</div>
			{#if !isRealtime && rtState.connection === 'closed' && kbpsUp === 0 && kbpsDown === 0}
				<div class="ok">실시간 세션이 완전히 종료되었고 전송이 중단되었습니다.</div>
			{/if}
		</div>
		{#if realtimeError}
			<p class="error">{realtimeError}</p>
		{/if}
	</section>

	{#if isRecording}
		<div class="status-pill danger">
			<span class="dot"></span>
			<span>녹음 중... {fmt(elapsedMs)}</span>
		</div>
	{:else}
		{#if recordedUrl}
			<div class="status-pill neutral">
				<span>완료 • {fmt(elapsedMs)}</span>
			</div>
		{/if}
	{/if}

	<div class="cta">
		{#if !isRecording}
			<button class="cta-btn" on:click={async () => { await ensureMic(); startRecording(); ensureCanvas(); }}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7-11-7z"/></svg>
				<span>녹음 시작</span>
			</button>
		{:else}
			<button class="cta-btn dark" on:click={stopRecording}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
				<span>녹음 중지</span>
			</button>
		{/if}
	</div>

	{#if recordedUrl}
		<div class="playback">
			<audio bind:this={audioEl} src={recordedUrl} controls></audio>
			<div class="playback-actions">
				<button on:click={sendToStt}>전사(STT)</button>
				<button on:click={async () => { await sendToStt(); await askLlm(); await ttsReply(); }}>질문→응답(TTS)</button>
				<button on:click={resetRecording}>다시 녹음</button>
				<button class="primary" on:click={downloadRecording}>다운로드</button>
			</div>
			{#if transcribedText}
				<p><strong>STT</strong>: {transcribedText}</p>
			{/if}
			{#if assistantReply}
				<p><strong>LLM</strong>: {assistantReply}</p>
			{/if}
			{#if replyAudioUrl}
				<audio src={replyAudioUrl} controls></audio>
			{/if}
		</div>
	{/if}

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}

	<div class="debug">
		<button on:click={() => debugOpen = !debugOpen}>{debugOpen ? '디버그 닫기' : '디버그 열기'}</button>
		{#if debugOpen}
			<ul class="log">
				{#each debugLogs as l}
					<li>
						<div class="log-head">[{l.time}] {l.step}</div>
						<pre>{l.message}</pre>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</main>

<svelte:window on:resize={ensureCanvas} on:load={ensureCanvas} />

<style>
	.container {
		min-height: 100vh;
		padding: 40px 16px;
		background: radial-gradient(1200px 600px at 20% -10%, #e8f0ff, transparent),
			radial-gradient(1200px 600px at 120% 110%, #e8f0ff, transparent);
	}
	.header { text-align: center; margin-bottom: 20px; }
	.header h1 { font-size: 32px; margin: 0 0 6px; color: #0f172a; }
	.subtitle { color: #475569; margin: 0; }
	.recorder-card {
		max-width: 720px;
		margin: 24px auto;
		padding: 16px;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		background: #ffffff;
		box-shadow: 0 1px 2px rgba(0,0,0,0.04);
	}
	.mic-badge {
		width: 64px; height: 64px;
		border-radius: 999px;
		background: #e5e7eb;
		display: flex; align-items: center; justify-content: center;
		margin: 8px auto 16px;
	}
	.wave-wrap {
		max-width: 560px; margin: 0 auto; padding: 12px; border-radius: 12px;
		background: #eef2ff; border: 1px solid #e5e7eb;
	}

	.status-pill {
		margin: 16px auto 0; padding: 10px 16px; border-radius: 999px;
		display: inline-flex; align-items: center; gap: 8px; font-weight: 600;
	}
	.status-pill .dot { width: 8px; height: 8px; border-radius: 999px; background: currentColor; display: inline-block; }
	.status-pill.danger { background: #fee2e2; color: #b91c1c; }
	.status-pill.neutral { background: #e5e7eb; color: #334155; }

	button {
		appearance: none;
		border: 1px solid #d1d5db;
		background: #f9fafb;
		padding: 8px 12px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 14px;
	}
	button:hover { background: #f3f4f6; }
	button:disabled { opacity: 0.6; cursor: not-allowed; }
	button.primary {
		background: #2563eb;
		border-color: #2563eb;
		color: white;
	}
	button.primary:hover { background: #1d4ed8; }
	.cta { display: flex; justify-content: center; margin: 20px 0 8px; }
	.cta-btn {
		border: none; background: #0f172a; color: #fff; font-size: 16px; font-weight: 700;
		padding: 16px 28px; border-radius: 999px; display: inline-flex; align-items: center; gap: 10px;
		box-shadow: 0 8px 24px rgba(15,23,42,0.15);
	}
	.cta-btn.dark { background: #0f172a; }
	.playback { max-width: 720px; margin: 8px auto 0; text-align: center; }
	.playback audio { width: 100%; }
	.playback-actions { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }
	.error { color: #b91c1c; }
	.ok { color: #15803d; }

	.debug { max-width: 920px; margin: 12px auto; }
	.log { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 8px; }
	.log-head { font-weight: 700; color: #334155; }
	pre { background: #0b1020; color: #e2e8f0; padding: 8px; border-radius: 8px; overflow: auto; }
	.rt-status { font-size: 12px; color: #334155; display: grid; gap: 4px; margin-top: 8px; }

</style>
