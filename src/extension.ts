import * as vscode from 'vscode';
import $, { $mol_tree2 } from 'mol_tree2';

let langsPromise: Thenable<$.$mol_tree2>

async function refresh() {
	langsPromise = vscode.workspace.findFiles( '**/*.lang.tree' ).then( async files => {
		
		const langs = [] as $.$mol_tree2[]
		
		for( const file of files ) {
			const buffer = await vscode.workspace.fs.readFile( file )
			const tree = $.$mol_tree2_from_string( buffer.toString(), file.toString() )
			langs.push( ... tree.kids )
		}
		
		return $.$mol_tree2.list( langs )
	} )
}
refresh()

const langWatcher = vscode.workspace.createFileSystemWatcher( '**/*.lang.tree' )
langWatcher.onDidChange( async uri => {
	refresh()
	provider.emit()
	return { dispose() {} }
} )

const legend = new vscode.SemanticTokensLegend([
	'comment', 'string', 'keyword', 'number', 'regexp', 'operator', 'namespace',
	'type', 'struct', 'class', 'interface', 'enum', 'typeParameter', 'function',
	'method', 'macro', 'variable', 'parameter', 'property', 'label', 'invalid'
],[])

const files = new WeakMap< vscode.TextDocument, $mol_tree2 >()

class DocumentSemanticTokensProvider implements
	vscode.DocumentSemanticTokensProvider,
	vscode.HoverProvider,
	vscode.CompletionItemProvider
{
	
	handlers = new Set<()=>void>()
	
	emit() {
		for( const handler of this.handlers ) handler()
	}
	
	onDidChangeSemanticTokens( handler: any ) {
		this.handlers.add( handler )
		return { dispose: ()=> this.handlers.delete( handler ) }
	}
	
	async provideDocumentSemanticTokens(
		document: vscode.TextDocument,
		token: vscode.CancellationToken,
	): Promise<vscode.SemanticTokens> {
		
		const lang = await getLang( document )
		const builder = new vscode.SemanticTokensBuilder( legend )
		
		const tree = $.$mol_ambient({
			$mol_fail: ( error: $.$mol_error_syntax ) => {
				builder.push(
					new vscode.Range(
						new vscode.Position(error.span.row-1, error.span.col-1),
						new vscode.Position(error.span.row-1, error.span.after().col-1),
					),
					'invalid',
					[],
				)
				return null as never
			},
		}).$mol_tree2_from_string( document.getText(), document.fileName )
		files.set( document, tree )
		
		const visit = ( node: $.$mol_tree2, override = '' )=> {
			
			let kind = override
				
			if( !override ) {
				
				let descr = lang?.select( '[]', node.type, null ).kids[0]
				
				lookup: if( !descr ) {
					const prefixes = lang?.select( '[:', null ).kids ?? []
					for( const prefix of prefixes ) {
						if( node.type.slice( 0, prefix.type.length ) === prefix.type ) {
							descr = prefix.kids[0]
							break lookup
						}
					}
				}
				
				kind = descr?.type ?? ( lang ? 'invalid' : classify( node.type ) )
				
				if( kind === 'comment' ) override = kind
			}
			
			builder.push(
				new vscode.Range(
					new vscode.Position(node.span.row-1, node.span.col-1),
					new vscode.Position(node.span.row-1, node.span.after().col-1),
				),
				kind,
				[],
			)
				
			for( let kid of node.kids ) visit( kid, override )
		}
		
		for( const kid of tree.kids ) visit( kid )
		
		return builder.build()
	}
	
	async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
	) {
		
		const tree = files.get(document)
		if( !tree ) return { contents: [] }
		
		const node = find( tree, position.line + 1, position.character + 1 )
		if( !node ) return { contents: [] }
		
		const lang = await getLang( document )
		if( !lang ) return { contents: [] }
		
		let exact = lang.select( '[]', node.type, null, null ).kids[0]
		if( exact ) return { contents: [ exact.text() ] }
		
		let prefixes = lang.select( '[:', null ).kids
		for( const prefix of prefixes ) {
			if( !node.type.startsWith( prefix.type ) ) continue
			return { contents: [ prefix.kids[0]?.text() ?? '' ] }
		}
		
		return { contents: [] }
		
	}
	
	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	) {
		
		const lang = await getLang( document )
		if( !lang ) return []
		
		const langTokens = [
			... lang.select( '[]', null ).kids,
			... lang.select( '[:', null ).kids,
		]
		
		const langItems = langTokens.map( kid => {
			const item = new vscode.CompletionItem(
				kid.type,
				vscode.CompletionItemKind.Class,
			)
			item.detail = kid.kids[0]?.text() ?? ''
			return item
		} )
		
		const fileTree = files.get( document )
		if( fileTree ) {
			const visit = ( tree: $mol_tree2 )=> {
				if( tree.type ) {
					const item = new vscode.CompletionItem(
						tree.type,
						vscode.CompletionItemKind.Text,
					)
					langItems.push( item )
				}
				for( const kid of tree.kids ) visit( kid )
			}
			visit( fileTree )
		}
		
		return new vscode.CompletionList( langItems )
		
	}
	
}

const getLang = async( document: vscode.TextDocument )=> {
	const langs = await langsPromise
	const langName = document.fileName.replace( /^.*\//, '' ).replace( /\.tree$/, '' ).replace( /^.*\./, '' )
	return langs.select( langName, 'kind' ).kids[0]
}

const find = ( tree: $mol_tree2, row: number, col: number ): $mol_tree2 | null => {
	if( row < tree.span.row ) return null
	if( row > tree.span.row ) return tree.kids.reduce(
		( res, kid )=> ( res || find( kid, row, col ) ),
		null as $mol_tree2 | null,
	)
	if( col < tree.span.col ) return null
	return tree.kids.reduce(
		( res, kid )=> ( res || find( kid, row, col ) ),
		null as $mol_tree2 | null,
	) ?? ( col > tree.span.col + tree.span.length ? null : tree )
}

const provider = new DocumentSemanticTokensProvider()

export function initialize() {
	return {
		"capabilities" : {
			"completionProvider" : {
				"resolveProvider": "false",
				"triggerCharacters": [ " ", "\t" ],
			},
		},	
	}
}

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider(
			'tree',
			provider,
			legend,
		),
		vscode.languages.registerHoverProvider('tree',  provider ),
		vscode.languages.registerCompletionItemProvider('tree',  provider, ".", "\t" ),
	)
}

function classify( type: string ) {
	if( !type ) return 'string'
	if( /^[-`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.]+(?![^ \t\n\\])$/.test( type ) ) return 'operator'
	if( /^[`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.][^ \t\n\\]+$/.test( type ) ) return 'keyword'
	return 'struct'
}
