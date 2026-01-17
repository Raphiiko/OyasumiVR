export interface DialogProperties {
	title: string;
	message: string;
	showCancel?: boolean;
	cancelText?: string;
	confirmText?: string;
	confirmColor?: 'normal' | 'blue' | 'red';
}
