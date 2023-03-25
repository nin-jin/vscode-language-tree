import * as vscode from 'vscode';
import $ from 'mol_tree2';

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

class DocumentSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
	
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
		
		const langs = await langsPromise
		const langName = document.fileName.replace( /^.*\//, '' ).replace( /\.tree$/, '' ).replace( /^.*\./, '' )
		const lang = langs.select( langName, 'kind' ).kids[0]
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
		
		const visit = ( node: $.$mol_tree2, override = '' )=> {
			
			// if( node.type || node.value || !node.kids.length ) {
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
				
			// }
			
			for( let kid of node.kids ) visit( kid, override )
		}
		
		for( const kid of tree.kids ) visit( kid )
		
		return builder.build()
	}

}

const provider = new DocumentSemanticTokensProvider()

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerDocumentSemanticTokensProvider(
			{ language: 'tree', scheme: 'file' },
			provider,
			legend,
		)
	)
}

function classify( type: string ) {
	if( !type ) return 'string'
	if( /^[-`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.]+(?![^ \t\n\\])$/.test( type ) ) return 'operator'
	if( /^[`~!@#$%\^&*()_=+|\/?"';:{}\[\]<>,.][^ \t\n\\]+$/.test( type ) ) return 'keyword'
	return 'struct'
}
