<script>
	import { user } from '$lib/auth.js';
	import { saveConversation } from '$lib/conversation.js';

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
	
	// 대화 기록 누적 저장
	let conversationHistory = [];
	let isSessionActive = false;
	let currentTab = 'current'; // 'current' or 'history'
	let chatMessagesContainer;
	
	// 시스템 프롬프트 설정
	let systemPrompt = 'You are an English conversation partner. Keep answers concise.';
	let showPromptEditor = false;
	let promptMode = 'preset'; // 'preset' or 'custom'
	let selectedPersonality = 'friendly'; // 기본값
	
	// 미리 정의된 선생님 성격
	const personalityPresets = {
		friendly: {
			name: '친근한 선생님',
			description: '따뜻하고 친근하게 대화하며 격려를 아끼지 않습니다.',
			prompt: 'You are a friendly and warm English teacher. You encourage students warmly and provide positive feedback. Keep answers concise but supportive.'
		},
		strict: {
			name: '엄격한 선생님',
			description: '정확한 문법과 발음을 강조하며 실수를 바로잡아줍니다.',
			prompt: 'You are a strict but fair English teacher. You emphasize correct grammar and pronunciation, and correct mistakes directly. Keep answers concise and focused on accuracy.'
		},
		humorous: {
			name: '유머러스한 선생님',
			description: '재미있고 유쾌하게 대화하며 학습을 즐겁게 만듭니다.',
			prompt: 'You are a humorous and fun English teacher. You make learning enjoyable with jokes and light-hearted conversation. Keep answers concise and entertaining.'
		},
		patient: {
			name: '인내심 있는 선생님',
			description: '천천히 설명하고 반복하여 이해를 돕습니다.',
			prompt: 'You are a patient English teacher. You explain things slowly and clearly, and are willing to repeat explanations. Keep answers concise but thorough.'
		},
		professional: {
			name: '전문적인 선생님',
			description: '비즈니스 영어와 공식적인 표현에 특화되어 있습니다.',
			prompt: 'You are a professional English teacher specializing in business English and formal expressions. You focus on professional communication skills. Keep answers concise and business-appropriate.'
		}
	};
	
	function updatePromptFromPersonality() {
		if (promptMode === 'preset' && personalityPresets[selectedPersonality]) {
			systemPrompt = personalityPresets[selectedPersonality].prompt;
		}
	}
	
	function switchToCustom() {
		promptMode = 'custom';
	}
	
	function startNewSession() {
		conversationHistory = [];
		isSessionActive = true;
	}
	
	// 편집기 열릴 때 기본값 설정
	$: if (showPromptEditor && promptMode === 'preset') {
		updatePromptFromPersonality();
	}
	
	function scrollToBottom() {
		if (chatMessagesContainer) {
			setTimeout(() => {
				chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
			}, 100);
		}
	}

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
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: transcribedText }
				]
			})
		});
		if (!r.ok) { assistantReply = ''; return; }
		const data = await r.json();
		assistantReply = data.choices?.[0]?.message?.content ?? '';
		
		// 대화 기록 저장 및 누적
		if ($user && transcribedText && assistantReply) {
			// AI 설정 정보 준비
			let personalityInfo = null;
			if (promptMode === 'preset' && personalityPresets[selectedPersonality]) {
				personalityInfo = {
					type: 'preset',
					key: selectedPersonality,
					name: personalityPresets[selectedPersonality].name,
					prompt: systemPrompt
				};
			} else if (promptMode === 'custom') {
				personalityInfo = {
					type: 'custom',
					key: null,
					name: '커스텀 설정',
					prompt: systemPrompt
				};
			}
			
			await saveConversation($user.id, transcribedText, assistantReply, personalityInfo);
			
			// 세션이 활성화되어 있지 않으면 자동으로 시작
			if (!isSessionActive) {
				isSessionActive = true;
			}
			
			// 로컬 대화 기록에 추가
			conversationHistory = [
				...conversationHistory,
				{
					userMessage: transcribedText,
					assistantReply: assistantReply,
					timestamp: new Date().toISOString(),
					personalityName: personalityInfo?.name || '기본 설정'
				}
			];
			
			// 새 메시지 추가 시 스크롤
			scrollToBottom();
		}
	}
	
	function formatTime(dateString) {
		const date = new Date(dateString);
		return date.toLocaleTimeString('ko-KR', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
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
		<h1>🎙️ 실시간 영어회화 AI</h1>
		<p class="subtitle">openai Realtime API로 실시간 영어회화 AI 서비스를 제공합니다.</p>
	</header>

	<!-- 세션 상태 및 새 세션 시작 -->
	<div class="session-controls">
		<div class="session-status">
			<span class="status-indicator {isSessionActive ? 'active' : 'inactive'}"></span>
			<span class="status-text">{isSessionActive ? '세션 활성' : '세션 비활성'}</span>
		</div>
		<div class="session-actions">
			<button class="prompt-edit-btn" on:click={() => showPromptEditor = !showPromptEditor}>
				{showPromptEditor ? '프롬프트 숨기기' : ' AI 선생님 설정 편집 '}
			</button>
			<button class="new-session-btn" on:click={startNewSession}>새 세션 시작</button>
		</div>
	</div>

	<!-- 시스템 프롬프트 설정 편집 -->
	{#if showPromptEditor}
		<div class="prompt-editor">
			<h3 class="prompt-editor-title">AI 선생님 성격 설정</h3>
			
			<!-- 모드 선택 -->
			<div class="prompt-mode-selector">
				<button 
					class="mode-btn {promptMode === 'preset' ? 'active' : ''}"
					on:click={() => { promptMode = 'preset'; updatePromptFromPersonality(); }}
				>
					미리 정의된 성격
				</button>
				<button 
					class="mode-btn {promptMode === 'custom' ? 'active' : ''}"
					on:click={() => promptMode = 'custom'}
				>
					커스텀 설정
				</button>
			</div>

			{#if promptMode === 'preset'}
				<!-- 미리 정의된 성격 선택 -->
				<div class="personality-selector">
					<div class="prompt-label">선생님 성격 선택</div>
					<div class="personality-grid">
						{#each Object.entries(personalityPresets) as [key, preset]}
							<button
								class="personality-card {selectedPersonality === key ? 'selected' : ''}"
								on:click={() => { selectedPersonality = key; updatePromptFromPersonality(); }}
							>
								<div class="personality-name">{preset.name}</div>
								<div class="personality-description">{preset.description}</div>
							</button>
						{/each}
					</div>
					<div class="current-prompt-preview">
						<div class="prompt-label">현재 프롬프트 미리보기</div>
						<div class="prompt-preview-text">{systemPrompt}</div>
					</div>
				</div>
			{:else}
				<!-- 커스텀 프롬프트 편집 -->
				<div class="custom-prompt-editor">
					<label for="system-prompt-input" class="prompt-label">
						커스텀 시스템 프롬프트 (AI의 역할과 응답 스타일을 직접 설정합니다)
					</label>
					<textarea
						id="system-prompt-input"
						class="prompt-textarea"
						bind:value={systemPrompt}
						placeholder="예: You are an English conversation partner. Keep answers concise."
						rows="4"
					></textarea>
				</div>
			{/if}

			<div class="prompt-actions">
				<button class="prompt-reset-btn" on:click={() => { 
					selectedPersonality = 'friendly';
					promptMode = 'preset';
					updatePromptFromPersonality();
				}}>
					기본값으로 복원
				</button>
				<button class="prompt-save-btn" on:click={() => showPromptEditor = false}>
					저장
				</button>
			</div>
		</div>
	{/if}

	<!-- 녹음 아이콘 -->
	<div class="recording-section">
		<div class="mic-icon-wrapper">
			<div class="mic-icon {isRecording ? 'recording' : ''}">
				<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" fill="currentColor"/>
					<path d="M5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8v3h2v-3a9 9 0 0 0 8-8 1 1 0 1 0-2 0 7 7 0 0 1-14 0Z" fill="currentColor"/>
				</svg>
			</div>
			{#if isRecording}
				<div class="recording-status">녹음 중... {fmt(elapsedMs)}</div>
			{/if}
		</div>
	</div>

	<!-- 연결 여부 -->
	<div class="connection-status">
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
	</div>

	<!-- AI 대화 시작 버튼과 디버그 버튼 -->
	<div class="action-buttons">
		{#if !isRecording}
			<button class="ai-chat-btn" on:click={async () => { await ensureMic(); startRecording(); ensureCanvas(); }}>
				AI 대화 시작
			</button>
		{:else}
			<button class="ai-chat-btn stop-btn" on:click={stopRecording}>
				녹음 중지
			</button>
		{/if}
		<button class="debug-btn" on:click={() => debugOpen = !debugOpen}>
			{debugOpen ? '디버그 닫기' : '디버그 열기'}
		</button>
	</div>

	<!-- 디버그 패널 -->
	{#if debugOpen}
		<div class="debug-panel">
			<ul class="log">
				{#each debugLogs as l}
					<li>
						<div class="log-head">[{l.time}] {l.step}</div>
						<pre>{l.message}</pre>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- 탭 -->
	<div class="tabs">
		<button class="tab-btn {currentTab === 'current' ? 'active' : ''}" on:click={() => currentTab = 'current'}>
			현재 대화
		</button>
		<button class="tab-btn {currentTab === 'history' ? 'active' : ''}" on:click={() => currentTab = 'history'}>
			대화 기록
		</button>
	</div>

	<!-- 탭 컨텐츠 -->
	<div class="tab-content">
		{#if currentTab === 'current'}
			<!-- 현재 대화 탭 -->
			<div class="current-conversation chat-style">
				{#if recordedUrl}
					<div class="playback">
						<audio bind:this={audioEl} src={recordedUrl} controls></audio>
						<div class="playback-actions">
							<button on:click={sendToStt}>전사(STT)</button>
							<button on:click={async () => { await sendToStt(); await askLlm(); await ttsReply(); }}>질문→응답(TTS)</button>
							<button on:click={resetRecording}>다시 녹음</button>
							<button class="primary" on:click={downloadRecording}>다운로드</button>
						</div>
						{#if replyAudioUrl}
							<audio src={replyAudioUrl} controls style="margin-top: 12px;"></audio>
						{/if}
					</div>
				{/if}
				
				{#if conversationHistory.length > 0}
					<div class="chat-messages" bind:this={chatMessagesContainer}>
						{#each conversationHistory as conversation (conversation.timestamp)}
							<!-- 사용자 메시지 -->
							<div class="chat-message user-message-bubble">
								<div class="bubble-content">
									<div class="bubble-text">{conversation.userMessage}</div>
									<div class="bubble-time">{formatTime(conversation.timestamp)}</div>
								</div>
							</div>
							<!-- AI 메시지 -->
							<div class="chat-message ai-message-bubble">
								<div class="bubble-content">
									{#if conversation.personalityName}
										<div class="personality-badge">{conversation.personalityName}</div>
									{/if}
									<div class="bubble-text">{conversation.assistantReply}</div>
									<div class="bubble-time">{formatTime(conversation.timestamp)}</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p>아직 대화가 없습니다. AI 대화 시작 버튼을 눌러 대화를 시작하세요.</p>
					</div>
				{/if}
			</div>
		{:else}
			<!-- 대화 기록 탭 -->
			<div class="history-tab">
				{#if conversationHistory.length > 0}
					<div class="conversation-list">
						{#each conversationHistory as conversation (conversation.timestamp)}
							<div class="conversation-item">
								<div class="conversation-time">{formatTime(conversation.timestamp)}</div>
								<div class="user-message">
									<div class="message-label">나</div>
									<div class="message-content">{conversation.userMessage}</div>
								</div>
								<div class="assistant-message">
									<div class="message-label">AI</div>
									<div class="message-content">
										{#if conversation.personalityName}
											<div class="personality-badge">{conversation.personalityName}</div>
										{/if}
										{conversation.assistantReply}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-state">
						<p>저장된 대화 기록이 없습니다.</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- 숨겨진 오디오 요소 -->
	<audio bind:this={remoteAudioEl} autoplay style="display: none;"></audio>

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
		max-width: 900px;
		margin: 0 auto;
	}

	.header {
		text-align: center;
		margin-bottom: 24px;
	}

	.header h1 {
		font-size: 32px;
		margin: 0 0 6px;
		color: #0f172a;
	}

	.subtitle {
		color: #475569;
		margin: 0;
	}

	/* 세션 컨트롤 */
	.session-controls {
		display: flex;
		justify-content: space-between;
		align-items: center;
		max-width: 720px;
		margin: 0 auto 24px;
		padding: 16px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.session-status {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.session-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.status-indicator {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		display: inline-block;
	}

	.status-indicator.active {
		background: #10b981;
		box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
	}

	.status-indicator.inactive {
		background: #94a3b8;
	}

	.status-text {
		font-size: 14px;
		font-weight: 600;
		color: #334155;
	}

	.new-session-btn {
		padding: 8px 16px;
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.new-session-btn:hover {
		background: #1d4ed8;
	}

	.prompt-edit-btn {
		padding: 8px 16px;
		background: #f9fafb;
		color: #334155;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.prompt-edit-btn:hover {
		background: #f3f4f6;
	}

	/* 프롬프트 편집기 */
	.prompt-editor {
		max-width: 720px;
		margin: 0 auto 24px;
		padding: 24px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.prompt-editor-title {
		font-size: 18px;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 20px 0;
	}

	/* 모드 선택 버튼 */
	.prompt-mode-selector {
		display: flex;
		gap: 8px;
		margin-bottom: 24px;
		border-bottom: 1px solid #e5e7eb;
		padding-bottom: 16px;
	}

	.mode-btn {
		flex: 1;
		padding: 10px 16px;
		background: #f9fafb;
		color: #64748b;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.mode-btn.active {
		background: #2563eb;
		color: white;
		border-color: #2563eb;
	}

	.mode-btn:hover:not(.active) {
		background: #f3f4f6;
		color: #334155;
	}

	/* 성격 선택 그리드 */
	.personality-selector {
		margin-bottom: 20px;
	}

	.personality-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}

	.personality-card {
		padding: 16px;
		background: #f9fafb;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}

	.personality-card:hover {
		background: #f3f4f6;
		border-color: #cbd5e1;
		transform: translateY(-2px);
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
	}

	.personality-card.selected {
		background: #eff6ff;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.personality-name {
		font-size: 16px;
		font-weight: 700;
		color: #0f172a;
		margin-bottom: 6px;
	}

	.personality-description {
		font-size: 13px;
		color: #64748b;
		line-height: 1.5;
	}

	/* 프롬프트 미리보기 */
	.current-prompt-preview {
		margin-top: 20px;
		padding: 16px;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}

	.prompt-preview-text {
		font-size: 13px;
		color: #334155;
		line-height: 1.6;
		margin-top: 8px;
		padding: 12px;
		background: white;
		border-radius: 6px;
		font-family: 'Courier New', monospace;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.prompt-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: #334155;
		margin-bottom: 8px;
	}

	.prompt-textarea {
		width: 100%;
		padding: 12px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
		min-height: 80px;
		line-height: 1.5;
		color: #0f172a;
		background: #f9fafb;
		transition: border-color 0.2s, background 0.2s;
	}

	.prompt-textarea:focus {
		outline: none;
		border-color: #2563eb;
		background: white;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.prompt-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	.prompt-reset-btn {
		padding: 8px 16px;
		background: #f9fafb;
		color: #64748b;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.prompt-reset-btn:hover {
		background: #f3f4f6;
		color: #334155;
	}

	.prompt-save-btn {
		padding: 8px 16px;
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.prompt-save-btn:hover {
		background: #1d4ed8;
	}

	/* 녹음 섹션 */
	.recording-section {
		display: flex;
		justify-content: center;
		margin-bottom: 24px;
	}

	.mic-icon-wrapper {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.mic-icon {
		width: 80px;
		height: 80px;
		border-radius: 50%;
		background: #e5e7eb;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #64748b;
		transition: all 0.3s;
	}

	.mic-icon.recording {
		background: #fee2e2;
		color: #b91c1c;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.1); }
	}

	.recording-status {
		font-size: 14px;
		font-weight: 600;
		color: #b91c1c;
	}

	/* 연결 상태 */
	.connection-status {
		max-width: 720px;
		margin: 0 auto 24px;
		padding: 16px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.rt-status {
		font-size: 12px;
		color: #334155;
		display: grid;
		gap: 4px;
	}

	.rt-status .ok {
		color: #15803d;
		margin-top: 8px;
	}

	.error {
		color: #b91c1c;
		margin-top: 8px;
		font-size: 14px;
	}

	/* 액션 버튼 */
	.action-buttons {
		display: flex;
		justify-content: center;
		gap: 12px;
		margin-bottom: 24px;
	}

	.ai-chat-btn {
		padding: 12px 24px;
		background: #0f172a;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.2s;
	}

	.ai-chat-btn:hover {
		background: #1e293b;
	}

	.ai-chat-btn.stop-btn {
		background: #b91c1c;
	}

	.ai-chat-btn.stop-btn:hover {
		background: #991b1b;
	}

	.debug-btn {
		padding: 12px 24px;
		background: #f9fafb;
		color: #334155;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.debug-btn:hover {
		background: #f3f4f6;
	}

	/* 디버그 패널 */
	.debug-panel {
		max-width: 920px;
		margin: 0 auto 24px;
		padding: 16px;
		background: #0b1020;
		border-radius: 12px;
		max-height: 400px;
		overflow-y: auto;
	}

	.log {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 8px;
	}

	.log-head {
		font-weight: 700;
		color: #e2e8f0;
		margin-bottom: 4px;
	}

	pre {
		background: #1e293b;
		color: #e2e8f0;
		padding: 8px;
		border-radius: 8px;
		overflow: auto;
		font-size: 12px;
	}

	/* 탭 */
	.tabs {
		display: flex;
		justify-content: center;
		gap: 8px;
		margin-bottom: 24px;
		max-width: 720px;
		margin-left: auto;
		margin-right: auto;
	}

	.tab-btn {
		flex: 1;
		padding: 12px 24px;
		background: white;
		color: #64748b;
		border: 1px solid #e5e7eb;
		border-radius: 8px 8px 0 0;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tab-btn.active {
		background: #f9fafb;
		color: #0f172a;
		border-bottom-color: transparent;
	}

	.tab-btn:hover:not(.active) {
		background: #f3f4f6;
	}

	/* 탭 컨텐츠 */
	.tab-content {
		max-width: 720px;
		margin: 0 auto;
		padding: 24px;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 0 0 12px 12px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
		min-height: 400px;
		max-height: 600px;
		overflow-y: auto;
	}

	.playback {
		margin-bottom: 24px;
		text-align: center;
	}

	.playback audio {
		width: 100%;
		margin-bottom: 12px;
	}

	.playback-actions {
		display: flex;
		gap: 8px;
		justify-content: center;
		flex-wrap: wrap;
	}

	.playback-actions button {
		padding: 8px 12px;
		background: #f9fafb;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.2s;
	}

	.playback-actions button:hover {
		background: #f3f4f6;
	}

	.playback-actions button.primary {
		background: #2563eb;
		color: white;
		border-color: #2563eb;
	}

	.playback-actions button.primary:hover {
		background: #1d4ed8;
	}

	/* 대화 목록 */
	.conversation-list {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.conversation-item {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-bottom: 20px;
		border-bottom: 1px solid #f1f5f9;
	}

	.conversation-item:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.conversation-time {
		font-size: 12px;
		color: #94a3b8;
		font-weight: 600;
		margin-bottom: 4px;
	}

	.user-message,
	.assistant-message {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.message-label {
		font-weight: 700;
		font-size: 12px;
		padding: 6px 10px;
		border-radius: 6px;
		white-space: nowrap;
		min-width: 40px;
		text-align: center;
	}

	.user-message .message-label {
		background: #dbeafe;
		color: #1e40af;
	}

	.assistant-message .message-label {
		background: #f3e8ff;
		color: #6b21a8;
	}

	.message-content {
		flex: 1;
		padding: 12px 16px;
		border-radius: 8px;
		color: #334155;
		line-height: 1.6;
		word-wrap: break-word;
	}

	.user-message .message-content {
		background: #eff6ff;
	}

	.assistant-message .message-content {
		background: #faf5ff;
	}

	/* 챗봇 스타일 말풍선 */
	.chat-style {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.chat-messages {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px 0;
		overflow-y: auto;
		flex: 1;
	}

	.chat-message {
		display: flex;
		margin-bottom: 4px;
		animation: fadeIn 0.3s ease-in;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.user-message-bubble {
		justify-content: flex-end;
	}

	.user-message-bubble .bubble-content {
		max-width: 70%;
		background: #2563eb;
		color: white;
		border-radius: 18px 18px 4px 18px;
		padding: 12px 16px;
		position: relative;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.ai-message-bubble {
		justify-content: flex-start;
	}

	.ai-message-bubble .bubble-content {
		max-width: 70%;
		background: #f1f5f9;
		color: #0f172a;
		border-radius: 18px 18px 18px 4px;
		padding: 12px 16px;
		position: relative;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.bubble-text {
		font-size: 14px;
		line-height: 1.5;
		word-wrap: break-word;
		margin-bottom: 4px;
	}

	.bubble-time {
		font-size: 11px;
		opacity: 0.7;
		margin-top: 4px;
		text-align: right;
	}

	.ai-message-bubble .bubble-time {
		text-align: left;
	}

	.personality-badge {
		display: inline-block;
		padding: 4px 8px;
		background: rgba(37, 99, 235, 0.1);
		color: #2563eb;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		margin-bottom: 8px;
	}

	/* 빈 상태 */
	.empty-state {
		text-align: center;
		padding: 60px 20px;
		color: #64748b;
	}

	.empty-state p {
		margin: 0;
		font-size: 14px;
	}
</style>
