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
				<button on:click={resetRecording}>다시 녹음</button>
				<button class="primary" on:click={downloadRecording}>다운로드</button>
			</div>
		</div>
	{/if}

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}
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

</style>
