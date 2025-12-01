import { getApiDocs } from '@/lib/swagger';
import SwaggerDocs from '@/components/SwaggerDocs';

export default async function ApiDocsPage() {
    const spec = await getApiDocs();
    return (
        <section className="container">
            <SwaggerDocs spec={spec} />
        </section>
    );
}
