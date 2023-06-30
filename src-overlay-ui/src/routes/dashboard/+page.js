export const ssr = false;

export async function load() {
	await window.CefSharp.BindObjectAsync('OyasumiIPCOut_Dashboard');
}
