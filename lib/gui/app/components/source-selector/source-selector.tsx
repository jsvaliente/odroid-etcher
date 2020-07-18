/*
 * Copyright 2016 balena.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { faFile, faLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { sourceDestination } from 'etcher-sdk';
import { ipcRenderer, IpcRendererEvent } from 'electron';
import * as _ from 'lodash';
import { GPTPartition, MBRPartition } from 'partitioninfo';
import * as path from 'path';
import * as React from 'react';
import { Async } from 'react-async';
import { ButtonProps, Card as BaseCard, Input, Modal, Txt, Flex, Table, Step, Steps, Button, Spinner } from 'rendition';
import styled from 'styled-components';

import * as errors from '../../../../shared/errors';
import * as messages from '../../../../shared/messages';
import * as supportedFormats from '../../../../shared/supported-formats';
import * as shared from '../../../../shared/units';
import * as selectionState from '../../models/selection-state';
import { observe } from '../../models/store';
import * as analytics from '../../modules/analytics';
import * as exceptionReporter from '../../modules/exception-reporter';
import * as osDialog from '../../os/dialog';
import { replaceWindowsNetworkDriveLetter } from '../../os/windows-network-drives';
import {
	ChangeButton,
	DetailsText,
	StepButton,
	StepNameButton,
} from '../../styled-components';
import { colors } from '../../theme';
import { middleEllipsis } from '../../utils/middle-ellipsis';
import { SVGIcon } from '../svg-icon/svg-icon';
// import { createFullTextSearchFilter } from 'rendition/dist/components/Filters/SchemaSieve';

import ImageSvg from '../../../assets/image.svg';

import { OdroidImageInfo, odroidImageFetch } from '../odroid/fetch';

const recentUrlImagesKey = 'recentUrlImages';

function normalizeRecentUrlImages(urls: any): string[] {
	if (!Array.isArray(urls)) {
		urls = [];
	}
	return _.chain(urls)
		.filter(_.isString)
		.reject(_.isEmpty)
		.uniq()
		.takeRight(5)
		.value();
}

function getRecentUrlImages(): string[] {
	let urls = [];
	try {
		urls = JSON.parse(localStorage.getItem(recentUrlImagesKey) || '[]');
	} catch {
		// noop
	}
	return normalizeRecentUrlImages(urls);
}

function setRecentUrlImages(urls: string[]) {
	localStorage.setItem(
		recentUrlImagesKey,
		JSON.stringify(normalizeRecentUrlImages(urls)),
	);
}

const Card = styled(BaseCard)`
	hr {
		margin: 5px 0;
	}
`;

// TODO move these styles to rendition
const ModalText = styled.p`
	a {
		color: rgb(0, 174, 239);

		&:hover {
			color: rgb(0, 139, 191);
		}
	}
`;

function getState() {
	return {
		hasImage: selectionState.hasImage(),
		imageName: selectionState.getImageName(),
		imageSize: selectionState.getImageSize(),
	};
}

const URLSelector = ({ done }: { done: (imageURL: string) => void }) => {
	const [imageURL, setImageURL] = React.useState('');
	const [recentImages, setRecentImages]: [
		string[],
		(value: React.SetStateAction<string[]>) => void,
	] = React.useState([]);
	const [loading, setLoading] = React.useState(false);
	React.useEffect(() => {
		const fetchRecentUrlImages = async () => {
			const recentUrlImages: string[] = await getRecentUrlImages();
			setRecentImages(recentUrlImages);
		};
		fetchRecentUrlImages();
	}, []);
	return (
		<Modal
			primaryButtonProps={{
				disabled: loading,
			}}
			done={async () => {
				setLoading(true);
				const sanitizedRecentUrls = normalizeRecentUrlImages([
					...recentImages,
					imageURL,
				]);
				setRecentUrlImages(sanitizedRecentUrls);
				await done(imageURL);
			}}
		>
			<label style={{ width: '100%' }}>
				<Txt mb="10px" fontSize="20px">
					Use Image URL
				</Txt>
				<Input
					value={imageURL}
					placeholder="Enter a valid URL"
					type="text"
					onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
						setImageURL(evt.target.value)
					}
				/>
			</label>
			{!_.isEmpty(recentImages) && (
				<div>
					Recent
					<Card
						style={{ padding: '10px 15px' }}
						rows={_.map(recentImages, (recent) => (
							<Txt
								key={recent}
								onClick={() => {
									setImageURL(recent);
								}}
							>
								<span>
									{_.last(_.split(recent, '/'))} - {recent}
								</span>
							</Txt>
						))}
					/>
				</div>
			)}
		</Modal>
	);
};

const OdroidImageSelector = ({
	done,
}: {
	done: (imageURL: string) => void;
}) => {
	const [imageURL, setImageURL] = React.useState('');
	const [recentImages, setRecentImages]: [
		string[],
		(value: React.SetStateAction<string[]>) => void,
	] = React.useState([]);

	// If imageURL variable has more than 7 letters, "http://".
	const isImageUrlSet = () => { return imageURL.length > 7 };

	React.useEffect(() => {
		const fetchRecentUrlImages = async () => {
			const recentUrlImages: string[] = await getRecentUrlImages();
			setRecentImages(recentUrlImages);
		};
		fetchRecentUrlImages();
	}, []);

	const ScrollableFlex = styled(Flex)`
	overflow: auto;

	::-webkit-scrollbar {
		display: none;
	}

	> div > div {
		/* This is required for the sticky table header in TargetsTable */
		overflow-x: visible;
	}
	`;

	const OdroidImagesTable = styled(({ refFn, ...props }) => {
	return (
		<div>
			<Table<OdroidImageInfo> ref={refFn} {...props} />
		</div>
	);
	})`
	[data-display='table-head'] [data-display='table-cell'] {
		position: sticky;
		top: 0;
		background-color: ${(props) => props.theme.colors.quartenary.light};
		font-color: grey;
	}

	[data-display='table-cell']:first-child {
		padding-left: 15px;
		width: 460px;
	}

	[data-display='table-cell']:last-child {
		width: 150px;
	}

	&& [data-display='table-row'] > [data-display='table-cell'] {
		padding: 6px 8px;
		color: #2a506f;
	}
	`;

	let isComplete = [false, false, false, false];
	const currentActiveStepIndex = () => {
		let index = 0;

		isComplete.forEach((element) => {
			if (element)
				index++;
		});

		return index;
	}

	interface OsSelectModalState {
		board: boolean;
		os: boolean;
		mirrorServer: boolean;
		image: boolean;
	}

	const ShowContents = (props: {
		setModalState: (nextState: OsSelectModalState) => void
	}) => {
		let contents = null;
		switch (currentActiveStepIndex()) {
			case 0: {
				contents = (
					<Button m={2} primary onClick={() => {
						props.setModalState({
							board: true,
							os: true,
							mirrorServer: false,
							image: false,
						});
					}}>
						Next
					</Button>
				);
				break;
			}
			case 1: {
				contents = (
					<Button m={2} primary onClick={() => {
						props.setModalState({
							board: true,
							os: true,
							mirrorServer: true,
							image: false,
						});
					}}>
						Next
					</Button>
				);
				break;
			}
			case 2: {
				contents = (
					<Button m={2} primary onClick={() => {
						props.setModalState({
							board: true,
							os: true,
							mirrorServer: true,
							image: true,
						});
					}}>
						Next
					</Button>
				);
				break;
			}
			case 3: {
				contents = (
					<Async
						promiseFn={async () => odroidImageFetch()}
					>
						{({ data, error, isLoading }) => {
							if (isLoading) return 'Loading...';
							if (error) return { error };

							if (data)
								return (
									<OdroidImagesTable
										columns={odroidImagesTableColumns}
										data={(data as OdroidImageInfo[]).map((imageInfo) =>
											imageInfo.toTableData(),
										)}
										rowKey="download_url"
										onRowClick={(row: any) => {
											console.log(
												'Clicked image file name: ' + row['file_name'],
											);
											setImageURL(row['download_url']);
										}}
									/>
								);
						}}
					</Async>
				);
				break;
			}
		}

		return contents;
	};

	const StepLabels = ['Board', 'OS', 'Mirror Server', 'Image'];

	const GetStep = (index: number) => {
		return (
			<Step
				key={index}
				status={isComplete[index] ? 'completed' : 'pending'}
			>
				{ StepLabels[index] }
			</Step>
		);
	};

	const OrderedStepsWrapper = ({ ...props }) => {
		return (
			<Steps ordered activeStepIndex={currentActiveStepIndex()} m={1} {...props}>
				{StepLabels.map((_, index) => GetStep(index))}
			</Steps>
		);
	};

	const odroidImagesTableColumns: any = [
		{
			field: 'file_name',
			label: 'Name',
			render: (value: string) => <code>{value}</code>,
		},
		{
			field: 'file_size',
			label: 'Size',
			render: (value: string) => <span>{value}</span>,
		},
		{
			field: 'last_modified',
			label: 'Last Modified',
			render: (value: string) => <span>{value}</span>,
		},
	];

	class OsSelectModal extends React.Component<
		{},
		OsSelectModalState
	> {
		constructor(props: {}) {
			super(props);

			this.state = {
				board: true,
				os: false,
				mirrorServer: false,
				image: false
			};

			this.update=this.update.bind(this);
		}

		public shouldComponentUpdate(_nextProps: {}, nextState: OsSelectModalState) {
			if (nextState['image']) {
				isComplete = [true, true, true, false];
			} else if (nextState['mirrorServer']) {
				isComplete = [true, true, false, false];
			} else if (nextState['os']) {
				isComplete = [true, false, false, false];
			} else {
				console.log('Something goes wrong, OsSelectModal will not render.');
				return false;
			}

			console.log(isComplete);

			return true;
		}

		private update(nextState: OsSelectModalState) {
			this.setState(nextState);
		}

		public render() {
			let contents = null;

			if (isImageUrlSet()) {
				contents = (
					<Flex width="100%" height="100%">
						<Spinner label='Downloading... Please wait for a moment...' emphasized />
					</Flex>
				);
			} else {
				contents = (
					<>
						<OrderedStepsWrapper bordered={false} />
						<ShowContents setModalState={this.update} />
					</>
				);
			}
			return contents;
		}
	}

	return (
		<Modal
			primaryButtonProps={{
				disabled: isImageUrlSet(),
			}}
			style={{
				width: '780px',
				height: '420px',
			}}
			done={async () => {
				const sanitizedRecentUrls = normalizeRecentUrlImages([
					...recentImages,
					imageURL,
				]);
				setRecentUrlImages(sanitizedRecentUrls);
				await done(imageURL);
			}}
		>
			<ScrollableFlex
				flexDirection="column"
				width="100%"
				height="calc(100% - 15px)"
			>
				<OsSelectModal />
			</ScrollableFlex>
		</Modal>
	);
};

interface Flow {
	icon?: JSX.Element;
	onClick: (evt: React.MouseEvent) => void;
	label: string;
}

const FlowSelector = styled(
	({ flow, ...props }: { flow: Flow; props?: ButtonProps }) => {
		return (
			<StepButton plain onClick={flow.onClick} icon={flow.icon} {...props}>
				{flow.label}
			</StepButton>
		);
	},
)`
	border-radius: 24px;
	color: rgba(255, 255, 255, 0.7);

	:enabled:hover {
		background-color: ${colors.primary.background};
		color: ${colors.primary.foreground};
		font-weight: 600;

		svg {
			color: ${colors.primary.foreground}!important;
		}
	}
`;

export type Source =
	| typeof sourceDestination.File
	| typeof sourceDestination.Http;

export interface SourceOptions {
	imagePath: string;
	SourceType: Source;
}

interface SourceSelectorProps {
	flashing: boolean;
	afterSelected: (options: SourceOptions) => void;
}

interface SourceSelectorState {
	hasImage: boolean;
	imageName: string;
	imageSize: number;
	warning: { message: string; title: string | null } | null;
	showImageDetails: boolean;
	showURLSelector: boolean;
	showOdroidImageSelector: boolean;
}

export class SourceSelector extends React.Component<
	SourceSelectorProps,
	SourceSelectorState
> {
	private unsubscribe: () => void;
	private afterSelected: SourceSelectorProps['afterSelected'];

	constructor(props: SourceSelectorProps) {
		super(props);
		this.state = {
			...getState(),
			warning: null,
			showImageDetails: false,
			showURLSelector: false,
			showOdroidImageSelector: false,
		};

		this.openImageSelector = this.openImageSelector.bind(this);
		this.openURLSelector = this.openURLSelector.bind(this);
		this.openOdroidImageSelector = this.openOdroidImageSelector.bind(this);
		this.reselectImage = this.reselectImage.bind(this);
		this.onSelectImage = this.onSelectImage.bind(this);
		this.onDrop = this.onDrop.bind(this);
		this.showSelectedImageDetails = this.showSelectedImageDetails.bind(this);
		this.afterSelected = props.afterSelected.bind(this);
	}

	public componentDidMount() {
		this.unsubscribe = observe(() => {
			this.setState(getState());
		});
		ipcRenderer.on('select-image', this.onSelectImage);
		ipcRenderer.send('source-selector-ready');
	}

	public componentWillUnmount() {
		this.unsubscribe();
		ipcRenderer.removeListener('select-image', this.onSelectImage);
	}

	private async onSelectImage(_event: IpcRendererEvent, imagePath: string) {
		const isURL =
			_.startsWith(imagePath, 'https://') || _.startsWith(imagePath, 'http://');
		await this.selectImageByPath({
			imagePath,
			SourceType: isURL ? sourceDestination.Http : sourceDestination.File,
		});
	}

	private reselectImage() {
		analytics.logEvent('Reselect image', {
			previousImage: selectionState.getImage(),
		});

		selectionState.deselectImage();
	}

	private selectImage(
		image: sourceDestination.Metadata & {
			path: string;
			extension: string;
			hasMBR: boolean;
		},
	) {
		try {
			let message = null;
			let title = null;

			if (supportedFormats.looksLikeWindowsImage(image.path)) {
				analytics.logEvent('Possibly Windows image', { image });
				message = messages.warning.looksLikeWindowsImage();
				title = 'Possible Windows image detected';
			} else if (!image.hasMBR) {
				analytics.logEvent('Missing partition table', { image });
				title = 'Missing partition table';
				message = messages.warning.missingPartitionTable();
			}

			if (message) {
				this.setState({
					warning: {
						message,
						title,
					},
				});
			}

			selectionState.selectImage(image);
			analytics.logEvent('Select image', {
				// An easy way so we can quickly identify if we're making use of
				// certain features without printing pages of text to DevTools.
				image: {
					...image,
					logo: Boolean(image.logo),
					blockMap: Boolean(image.blockMap),
				},
			});
		} catch (error) {
			exceptionReporter.report(error);
		}
	}

	private async selectImageByPath({ imagePath, SourceType }: SourceOptions) {
		try {
			imagePath = await replaceWindowsNetworkDriveLetter(imagePath);
		} catch (error) {
			analytics.logException(error);
		}

		let source;
		if (SourceType === sourceDestination.File) {
			source = new sourceDestination.File({
				path: imagePath,
			});
		} else {
			if (
				!_.startsWith(imagePath, 'https://') &&
				!_.startsWith(imagePath, 'http://')
			) {
				const invalidImageError = errors.createUserError({
					title: 'Unsupported protocol',
					description: messages.error.unsupportedProtocol(),
				});

				osDialog.showError(invalidImageError);
				analytics.logEvent('Unsupported protocol', { path: imagePath });
				return;
			}
			source = new sourceDestination.Http({ url: imagePath });
		}

		try {
			const innerSource = await source.getInnerSource();
			const metadata = (await innerSource.getMetadata()) as sourceDestination.Metadata & {
				hasMBR: boolean;
				partitions: MBRPartition[] | GPTPartition[];
				path: string;
				extension: string;
			};
			const partitionTable = await innerSource.getPartitionTable();
			if (partitionTable) {
				metadata.hasMBR = true;
				metadata.partitions = partitionTable.partitions;
			} else {
				metadata.hasMBR = false;
			}
			metadata.path = imagePath;
			metadata.extension = path.extname(imagePath).slice(1);
			this.selectImage(metadata);
			this.afterSelected({
				imagePath,
				SourceType,
			});
		} catch (error) {
			const imageError = errors.createUserError({
				title: 'Error opening image',
				description: messages.error.openImage(
					path.basename(imagePath),
					error.message,
				),
			});
			osDialog.showError(imageError);
			analytics.logException(error);
		} finally {
			try {
				await source.close();
			} catch (error) {
				// Noop
			}
		}
	}

	private async openImageSelector() {
		analytics.logEvent('Open image selector');

		try {
			const imagePath = await osDialog.selectImage();
			// Avoid analytics and selection state changes
			// if no file was resolved from the dialog.
			if (!imagePath) {
				analytics.logEvent('Image selector closed');
				return;
			}
			this.selectImageByPath({
				imagePath,
				SourceType: sourceDestination.File,
			});
		} catch (error) {
			exceptionReporter.report(error);
		}
	}

	private onDrop(event: React.DragEvent<HTMLDivElement>) {
		const [file] = event.dataTransfer.files;
		if (file) {
			this.selectImageByPath({
				imagePath: file.path,
				SourceType: sourceDestination.File,
			});
		}
	}

	private openURLSelector() {
		analytics.logEvent('Open image URL selector');

		this.setState({
			showURLSelector: true,
		});
	}

	private openOdroidImageSelector() {
		analytics.logEvent('Open Odroid image URL selector');

		this.setState({
			showOdroidImageSelector: true,
		});
	}

	private onDragOver(event: React.DragEvent<HTMLDivElement>) {
		// Needed to get onDrop events on div elements
		event.preventDefault();
	}

	private onDragEnter(event: React.DragEvent<HTMLDivElement>) {
		// Needed to get onDrop events on div elements
		event.preventDefault();
	}

	private showSelectedImageDetails() {
		analytics.logEvent('Show selected image tooltip', {
			imagePath: selectionState.getImagePath(),
		});

		this.setState({
			showImageDetails: true,
		});
	}

	// TODO add a visual change when dragging a file over the selector
	public render() {
		const { flashing } = this.props;
		const {
			showImageDetails,
			showURLSelector,
			showOdroidImageSelector,
		} = this.state;

		const hasImage = selectionState.hasImage();

		const imagePath = selectionState.getImagePath();
		const imageBasename = hasImage ? path.basename(imagePath) : '';
		const imageName = selectionState.getImageName();
		const imageSize = selectionState.getImageSize();
		const imageLogo = selectionState.getImageLogo();

		return (
			<>
				<div
					className="box text-center relative"
					onDrop={this.onDrop}
					onDragEnter={this.onDragEnter}
					onDragOver={this.onDragOver}
				>
					<div className="center-block">
						<SVGIcon
							contents={imageLogo}
							fallback={<ImageSvg width="40px" height="40px" />}
						/>
					</div>

					<div className="space-vertical-large">
						{hasImage ? (
							<>
								<StepNameButton
									plain
									fontSize={16}
									onClick={this.showSelectedImageDetails}
									tooltip={imageName || imageBasename}
								>
									{middleEllipsis(imageName || imageBasename, 20)}
								</StepNameButton>
								{!flashing && (
									<ChangeButton plain mb={14} onClick={this.reselectImage}>
										Remove
									</ChangeButton>
								)}
								<DetailsText>
									{shared.bytesToClosestUnit(imageSize)}
								</DetailsText>
							</>
						) : (
							<>
								<FlowSelector
									key="Flash from file"
									flow={{
										onClick: this.openImageSelector,
										label: 'Flash from file',
										icon: <FontAwesomeIcon icon={faFile} />,
									}}
								/>
								<FlowSelector
									key="Flash from URL"
									flow={{
										onClick: this.openURLSelector,
										label: 'Flash from URL',
										icon: <FontAwesomeIcon icon={faLink} />,
									}}
								/>
								<FlowSelector
									key="Odroid images"
									flow={{
										onClick: this.openOdroidImageSelector,
										label: 'Odroid images',
										icon: <FontAwesomeIcon icon={faLink} />,
									}}
								/>
							</>
						)}
					</div>
				</div>

				{this.state.warning != null && (
					<Modal
						titleElement={
							<span>
								<span
									style={{ color: '#d9534f' }}
									className="glyphicon glyphicon-exclamation-sign"
								></span>{' '}
								<span>{this.state.warning.title}</span>
							</span>
						}
						action="Continue"
						cancel={() => {
							this.setState({ warning: null });
							this.reselectImage();
						}}
						done={() => {
							this.setState({ warning: null });
						}}
						primaryButtonProps={{ warning: true, primary: false }}
					>
						<ModalText
							dangerouslySetInnerHTML={{ __html: this.state.warning.message }}
						/>
					</Modal>
				)}

				{showImageDetails && (
					<Modal
						title="Image"
						done={() => {
							this.setState({ showImageDetails: false });
						}}
					>
						<Txt.p>
							<Txt.span bold>Name: </Txt.span>
							<Txt.span>{imageName || imageBasename}</Txt.span>
						</Txt.p>
						<Txt.p>
							<Txt.span bold>Path: </Txt.span>
							<Txt.span>{imagePath}</Txt.span>
						</Txt.p>
					</Modal>
				)}

				{showURLSelector && (
					<URLSelector
						done={async (imageURL: string) => {
							// Avoid analytics and selection state changes
							// if no file was resolved from the dialog.
							if (!imageURL) {
								analytics.logEvent('URL selector closed');
								this.setState({
									showURLSelector: false,
								});
								return;
							}

							await this.selectImageByPath({
								imagePath: imageURL,
								SourceType: sourceDestination.Http,
							});
							this.setState({
								showURLSelector: false,
							});
						}}
					/>
				)}
				{showOdroidImageSelector && (
					<OdroidImageSelector
						done={async (imageURL: string) => {
							// Avoid analytics and selection state changes
							// if no file was resolved from the dialog.
							if (!imageURL) {
								analytics.logEvent('URL selector closed');
								this.setState({
									showOdroidImageSelector: false,
								});
								return;
							}

							await this.selectImageByPath({
								imagePath: imageURL,
								SourceType: sourceDestination.Http,
							});
							this.setState({
								showOdroidImageSelector: false,
							});
						}}
					/>
				)}
			</>
		);
	}
}
