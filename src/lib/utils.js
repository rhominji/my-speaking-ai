import { browser } from '$app/environment';

/**
 * 현재 환경에 맞는 URL을 반환합니다.
 * Vercel 배포 시 자동으로 올바른 URL을 감지합니다.
 */
export function getSiteURL() {
	if (!browser) {
		// 서버 사이드에서는 환경 변수 사용
		return import.meta.env.PUBLIC_SITE_URL || 'https://my-speaking-ai.vercel.app';
	}

	// 클라이언트 사이드에서는 현재 URL 사용
	const url = window.location.origin;
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * 리다이렉트 URL을 생성합니다.
 * @param {string} path - 리다이렉트할 경로
 * @returns {string} 완전한 URL
 */
export function getRedirectURL(path = '/') {
	const baseURL = getSiteURL();
	const cleanPath = path.startsWith('/') ? path : `/${path}`;
	return `${baseURL}${cleanPath}`;
}

