export async function load() {
	if (window.CefSharp) await window.CefSharp.BindObjectAsync('OyasumiIPCOut_Dashboard');
}
